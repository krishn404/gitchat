"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { FileText, Code, Github, Send, Loader2, User, Square } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import ReactMarkdown from "react-markdown"
import { CodeBlock } from "./code-block"
import { useRouter, useParams } from "next/navigation"
import { v4 as uuidv4 } from "uuid"
import { ChatHistory } from "./chat-history"
import { useAuth } from "@/contexts/auth-context"
import Link from "next/link"
import { motion } from "framer-motion"

// Add these imports at the top
import { parseGitHubLink } from "@/lib/github-link-parser"
import { GitHubProfile } from "@/components/github/github-profile"
import { RepoAnalyzer } from "@/components/github/repo-analyzer"

interface Message {
  role: "user" | "assistant"
  content: string
  timestamp?: Date
}

interface CodeProps {
  node?: any
  inline?: boolean
  className?: string
  children: React.ReactNode
}

interface ChatProps {
  initialSessionId?: string
  initialMessages?: Message[]
}

export function Chat({ initialSessionId, initialMessages = [] }: ChatProps) {
  const { user, logout } = useAuth()
  const [sessionId, setSessionId] = useState<string>(initialSessionId || uuidv4())
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [loadingDots, setLoadingDots] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [animatedText, setAnimatedText] = useState("")
  const [isAnimating, setIsAnimating] = useState(false)
  const [sessionTitle, setSessionTitle] = useState<string>("")
  const router = useRouter()
  const params = useParams()

  // Add this state after the other state variables
  const [githubLink, setGithubLink] = useState<{ type: "profile" | "repository"; value: string } | null>(null)
  const [isResponding, setIsResponding] = useState(false)
  const [shouldStop, setShouldStop] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)

  // Load existing chat session if sessionId is provided
  useEffect(() => {
    if (params?.sessionId && !initialMessages.length) {
      fetchChatSession(params.sessionId as string)
    }
  }, [params?.sessionId, initialMessages.length])

  const fetchChatSession = async (id: string) => {
    try {
      setIsLoading(true)
      const response = await fetch(`/api/chat-history/${id}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch chat session")
      }

      setSessionId(id)
      setMessages(data.session.messages)
      setSessionTitle(data.session.title)
    } catch (err) {
      console.error("Error fetching chat session:", err)
      // Redirect to home if session not found
      router.push("/")
    } finally {
      setIsLoading(false)
    }
  }

  // Save chat session to database
  const saveChatSession = async (newMessages: Message[]) => {
    try {
      if (newMessages.length === 0) return

      const title =
        sessionTitle || newMessages[0].content.substring(0, 30) + (newMessages[0].content.length > 30 ? "..." : "")

      const method = initialSessionId ? "PUT" : "POST"
      const url = initialSessionId ? `/api/chat-history/${sessionId}` : "/api/chat-history"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          messages: newMessages.map((msg) => ({
            ...msg,
            timestamp: msg.timestamp || new Date(),
          })),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to save chat session")
      }

      if (!initialSessionId) {
        // Update URL with new session ID without reloading the page
        window.history.pushState({}, "", `/chat/${data.session.sessionId}`)
        setSessionId(data.session.sessionId)
      }

      setSessionTitle(data.session.title || title)
    } catch (err) {
      console.error("Error saving chat session:", err)
    }
  }

  // Auto-scroll to bottom when messages change
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Add this useEffect for the dots animation
  useEffect(() => {
    if (!isLoading) return

    const interval = setInterval(() => {
      setLoadingDots((dots) => (dots.length >= 3 ? "" : dots + "."))
    }, 500)

    return () => clearInterval(interval)
  }, [isLoading])

  const handleStop = () => {
    if (abortController) {
      abortController.abort()
      setAbortController(null)
    }
    setIsResponding(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isResponding) return

    setIsResponding(true)
    const controller = new AbortController()
    setAbortController(controller)

    try {
      const userMessage = { role: "user" as const, content: input, timestamp: new Date() }
      const updatedMessages = [...messages, userMessage]
      setMessages(updatedMessages)
      setInput("")
      setIsLoading(true)
      setGithubLink(null) // Reset GitHub link

      // Save the user message to the database
      await saveChatSession(updatedMessages)

      // Modify the handleSubmit function to detect GitHub links
      // Add this after setting userMessage but before the fetch call:
      const parsedLink = parseGitHubLink(input)
      if (parsedLink) {
        if (parsedLink.type === "profile") {
          setGithubLink({ type: "profile", value: parsedLink.owner })
        } else if (parsedLink.type === "repository") {
          setGithubLink({ type: "repository", value: `${parsedLink.owner}/${parsedLink.repo}` })
        }
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages }),
        signal: controller.signal
      })

      if (!response.ok) throw new Error("Failed to fetch response")

      const text = await response.text()
      setAnimatedText("")
      setIsAnimating(true)

      // Add empty assistant message first
      const assistantMessage = { role: "assistant" as const, content: "", timestamp: new Date() }
      const newMessages = [...updatedMessages, assistantMessage]
      setMessages(newMessages)

      // Animate the text word by word
      const words = text.split(/(\s+)/)
      for (let i = 0; i < words.length; i++) {
        if (controller.signal.aborted) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 30))
        setMessages((prev) => {
          const newMessages = [...prev]
          newMessages[newMessages.length - 1].content = words.slice(0, i + 1).join("")
          return newMessages
        })
        scrollToBottom()
      }

      // Save the completed conversation to the database
      const finalMessages = [
        ...updatedMessages,
        {
          role: "assistant",
          content: text,
          timestamp: new Date(),
        },
      ]
      setMessages(finalMessages)
      await saveChatSession(finalMessages)

      setIsAnimating(false)

      // Check if should stop during response streaming
      if (shouldStop) {
        setIsResponding(false)
        return
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Response generation was stopped')
      } else {
        console.error(error)
      }
    } finally {
      setIsLoading(false)
      setIsResponding(false)
      setShouldStop(false)
      setAbortController(null)
    }
  }

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return "Good morning"
    if (hour < 18) return "Good afternoon"
    return "Good evening"
  }

  // Convert URLs in text to badge-style links
  const LinkRenderer = ({ href, children }: { href?: string; children: React.ReactNode }) => {
    if (!href) return <>{children}</>

    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-muted text-primary hover:bg-muted/80 transition-colors text-xs"
      >
        {children}
      </a>
    )
  }

  // Add this new function to handle the custom prompt
  async function handleSubmitWithPrompt(prompt: string) {
    const userMessage = { role: "user" as const, content: prompt, timestamp: new Date() }
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setIsLoading(true)
    setGithubLink(null) // Reset GitHub link

    // Save the user message to the database
    await saveChatSession(updatedMessages)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages }),
      })

      if (!response.ok) throw new Error("Failed to fetch response")

      const text = await response.text()
      setAnimatedText("")
      setIsAnimating(true)

      // Add empty assistant message first
      const assistantMessage = { role: "assistant" as const, content: "", timestamp: new Date() }
      const newMessages = [...updatedMessages, assistantMessage]
      setMessages(newMessages)

      // Animate the text word by word
      const words = text.split(/(\s+)/)
      for (let i = 0; i < words.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10)) // Adjust speed here
        setMessages((prev) => {
          const newMessages = [...prev]
          newMessages[newMessages.length - 1].content = words.slice(0, i + 1).join("")
          return newMessages
        })
        scrollToBottom()
      }

      // Save the completed conversation to the database
      const finalMessages = [
        ...updatedMessages,
        {
          role: "assistant",
          content: text,
          timestamp: new Date(),
        },
      ]
      setMessages(finalMessages)
      await saveChatSession(finalMessages)

      setIsAnimating(false)
    } catch (error) {
      console.error("Error:", error)
      const errorMessage = {
        role: "assistant",
        content: "Sorry, there was an error processing your request.",
        timestamp: new Date(),
      }
      const errorMessages = [...updatedMessages, errorMessage]
      setMessages(errorMessages)
      await saveChatSession(errorMessages)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Chat History Sidebar */}
      {/* <ChatHistory /> */}

      {/* Top Navigation - Minimal header */}
      <header className="p-4 sm:p-4 fixed top-0 left-0 right-0 z-10 bg-gradient-to-b from-background to-transparent">
        <div className="max-w-screen-xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2 ml-12">
            <Github className="h-5 w-5 text-foreground" />
            <span className="text-lg sm:text-xl font-semibold text-foreground">Git Friend</span>
          </div>

          {/* Add profile link */}
          {user && (
            <Link
              href="/profile"
              className="flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-muted/80 rounded-full transition-colors"
            >
              {user.photoURL ? (
                <img
                  src={user.photoURL || "/placeholder.svg"}
                  alt={user.displayName || "User"}
                  className="w-6 h-6 rounded-full"
                />
              ) : (
                <User className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user.displayName?.split(" ")[0] || "Profile"}
              </span>
            </Link>
          )}
        </div>
      </header>

      {/* Main Chat Area - Scrollable content */}
      <div
        className={`flex-1 flex flex-col items-center p-2 sm:p-4 w-full mt-14 ${messages.length > 0 ? "mb-32 overflow-y-auto" : "justify-center"}`}
      >
        <div className="w-full max-w-3xl space-y-4">
          {messages.length === 0 ? (
            <div className="text-center space-y-4 px-2 sm:px-4">
              <div className="relative">
                <motion.div 
                  className="absolute -top-20 -left-20 w-64 h-64 bg-primary/5 rounded-full filter blur-3xl"
                  animate={{ scale: [1, 1.1, 1], opacity: [0.2, 0.3, 0.2] }}
                  transition={{ duration: 15, repeat: Infinity, repeatType: "reverse" }}
                ></motion.div>
                <motion.div 
                  className="absolute -bottom-20 -right-20 w-64 h-64 bg-secondary/5 rounded-full filter blur-3xl"
                  animate={{ scale: [1, 1.15, 1], opacity: [0.2, 0.3, 0.2] }}
                  transition={{ duration: 20, repeat: Infinity, repeatType: "reverse", delay: 5 }}
                ></motion.div>

                <motion.h1 
                  className="text-3xl sm:text-4xl font-bold text-foreground"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6 }}
                >
                  {getGreeting()}, {user?.displayName?.split(" ")[0] || "there"}
                </motion.h1>
                <motion.p 
                  className="text-lg sm:text-xl text-muted-foreground mt-2"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                >
                  How can I help you with Git and GitHub today?
                </motion.p>
              </div>

              {/* New Input Area for welcome screen - Centered */}
              <motion.div 
                className="mt-12 w-full max-w-3xl mx-auto"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <div className="relative rounded-xl bg-card border border-border p-3">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask me anything about Git or GitHub..."
                    className="w-full bg-transparent border-0 focus:ring-0 text-foreground placeholder:text-muted-foreground resize-none py-3 px-3 min-h-[60px] text-lg"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleSubmit(e)
                      }
                    }}
                  />
                  <Button
                    onClick={handleSubmit}
                    className="absolute right-4 bottom-4 w-10 h-10 rounded-full bg-primary hover:bg-primary/90 flex items-center justify-center"
                  >
                    <Send className="h-5 w-5 text-primary-foreground" />
                  </Button>
                </div>

                {/* Feature buttons */}
                <div className="flex flex-wrap justify-center gap-3 mt-8">
                  <Button
                    variant="outline"
                    className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-4 py-2 rounded-xl bg-card hover:bg-muted transition-all"
                    onClick={() => handleSubmitWithPrompt("What are the trending repositories on GitHub right now?")}
                  >
                    <FileText className="h-4 w-4" />
                    <span>Trending Repos</span>
                  </Button>

                  <Button
                    variant="outline"
                    className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-4 py-2 rounded-xl bg-card hover:bg-muted transition-all"
                    onClick={() => handleSubmitWithPrompt("How do I create a new repository on GitHub?")}
                  >
                    <FileText className="h-4 w-4" />
                    <span>Create Repo</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-4 py-2 rounded-xl bg-card hover:bg-muted transition-all"
                    onClick={() => handleSubmitWithPrompt("What are the most common Git commands?")}
                  >
                    <Code className="h-4 w-4" />
                    <span>Commands</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-4 py-2 rounded-xl bg-card hover:bg-muted transition-all"
                    onClick={() => (window.location.href = "/github")}
                  >
                    <Github className="h-4 w-4" />
                    <span>GitHub Tools</span>
                  </Button>
                </div>
              </motion.div>
            </div>
          ) : (
            <div className="space-y-6 px-2 sm:px-0">
              {messages.map((message, i) => (
                <div key={i} className="flex gap-3 min-w-0">
                  {message.role === "user" ? (
                    <div className="bg-primary/20 border border-primary/20 rounded-2xl py-3 px-4 self-end text-foreground w-fit max-w-[80%] ml-auto">
                      {message.content}
                    </div>
                  ) : (
                    <div className="w-full">
                      <div
                        className={`prose dark:prose-invert max-w-none flex-1 overflow-hidden bg-card border border-border rounded-2xl p-4 ${
                          message.role === "assistant" ? "animate-in fade-in-50 duration-300" : ""
                        }`}
                      >
                        <ReactMarkdown
                          components={{
                            code({ inline, className, children, ...props }: CodeProps) {
                              const match = /language-(\w+)/.exec(className || "")
                              if (!inline && match) {
                                return (
                                  <div className="max-w-full overflow-x-auto">
                                    <CodeBlock code={String(children).replace(/\n$/, "")} language={match[1]} />
                                  </div>
                                )
                              }
                              return (
                                <code className={`${className} bg-muted px-1.5 py-0.5 rounded text-sm`} {...props}>
                                  {children}
                                </code>
                              )
                            },
                            div: ({ children }) => <div className="max-w-full overflow-x-hidden">{children}</div>,
                            h1: ({ children }) => (
                              <h1 className="text-xl sm:text-2xl font-semibold text-foreground mb-4">{children}</h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="text-lg sm:text-xl font-semibold text-foreground mt-6 mb-3">{children}</h2>
                            ),
                            p: ({ children }) => <p className="text-foreground leading-7 break-words mb-4">{children}</p>,
                            ul: ({ children }) => <ul className="list-disc list-inside space-y-2 mb-4">{children}</ul>,
                            li: ({ children }) => (
                              <li className="text-foreground leading-7 flex items-start">
                                <span className="inline-block w-2 h-2 bg-muted-foreground rounded-full mt-3 mr-3 flex-shrink-0"></span>
                                <span className="flex-1">{children}</span>
                              </li>
                            ),
                            a: ({ href, children }) => <LinkRenderer href={href}>{children}</LinkRenderer>,
                            strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>

                      {/* Add GitHub link analysis after assistant message */}
                      {i === messages.length - 1 && githubLink && (
                        <div className="mt-4 w-full animate-in fade-in-50 slide-in-from-bottom-5 duration-500">
                          <div className="bg-card border border-border rounded-2xl p-4">
                            <h3 className="text-foreground text-lg font-medium mb-4 flex items-center gap-2">
                              <Github className="h-5 w-5 text-primary" />
                              {githubLink.type === "profile" ? "GitHub Profile Analysis" : "Repository Analysis"}
                            </h3>
                            {githubLink.type === "profile" ? (
                              <GitHubProfile initialUsername={githubLink.value} />
                            ) : (
                              <RepoAnalyzer initialRepo={githubLink.value} />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
              {/* Add extra padding at the bottom to ensure content is not hidden */}
              <div className="h-4"></div>
            </div>
          )}
          {isLoading && (
            <div className="flex gap-3">
              <div className="flex items-center gap-2 text-muted-foreground bg-card border border-border rounded-2xl p-4 animate-pulse">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span>Thinking{loadingDots}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer - Only show on welcome screen */}
      {messages.length === 0 && (
        <div className="text-center p-4 text-xs sm:text-sm text-muted-foreground">
          Developed by{" "}
          <a href="https://github.com/krishn404" className="text-muted-foreground hover:text-foreground">
            Krishna
          </a>{" "}
          Open Source at{" "}
          <a href="https://github.com/krishn404/gitchat" className="text-muted-foreground hover:text-foreground">
            Git Friend
          </a>
          .
        </div>
      )}

      {/* Sticky Input Area - Only when conversations are active */}
      {messages.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-background to-transparent p-4">
          <div className="max-w-3xl mx-auto">
            <div className="relative rounded-xl bg-card border border-border p-3">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask me anything about Git or GitHub..."
                className="w-full bg-transparent border-0 focus:ring-0 text-foreground placeholder:text-muted-foreground resize-none py-3 px-3 min-h-[60px] pr-12"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleSubmit(e)
                  }
                }}
              />
              <Button
                onClick={isResponding ? handleStop : handleSubmit}
                className="absolute right-4 bottom-4 w-10 h-10 rounded-full bg-primary hover:bg-primary/90 flex items-center justify-center"
              >
                {isResponding ? (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                  >
                    <Square className="h-5 w-5 text-primary-foreground" />
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                  >
                    <Send className="h-5 w-5 text-primary-foreground" />
                  </motion.div>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}