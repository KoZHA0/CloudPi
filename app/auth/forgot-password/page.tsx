"use client"

import { useState } from "react"
import Link from "next/link"
import { Cloud, Loader2, ArrowLeft, Mail, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function ForgotPasswordPage() {
    const [isLoading, setIsLoading] = useState(false)
    const [isSubmitted, setIsSubmitted] = useState(false)
    const [email, setEmail] = useState("")

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)

        // Simulate sending reset email - replace with actual logic
        await new Promise((resolve) => setTimeout(resolve, 1500))

        setIsSubmitted(true)
        setIsLoading(false)
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            {/* Background gradient effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />

            {/* Floating orbs for visual interest */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />

            <div className="relative w-full max-w-md">
                {/* Logo */}
                <div className="flex items-center justify-center gap-3 mb-8">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/20">
                        <Cloud className="h-7 w-7 text-primary" />
                    </div>
                    <span className="text-2xl font-bold text-foreground">Cloud-Pi</span>
                </div>

                <Card className="border-border bg-card/80 backdrop-blur-xl shadow-2xl">
                    {!isSubmitted ? (
                        <>
                            <CardHeader className="space-y-1 text-center pb-4">
                                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/20 mx-auto mb-2">
                                    <Mail className="h-7 w-7 text-primary" />
                                </div>
                                <CardTitle className="text-2xl font-bold text-card-foreground">Forgot password?</CardTitle>
                                <CardDescription>
                                    No worries, we&apos;ll send you reset instructions
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="email" className="text-sm font-medium text-card-foreground">
                                            Email
                                        </Label>
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder="you@example.com"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className="bg-secondary border-border"
                                            required
                                        />
                                    </div>

                                    <Button
                                        type="submit"
                                        className="w-full gap-2"
                                        disabled={isLoading}
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Sending...
                                            </>
                                        ) : (
                                            "Reset password"
                                        )}
                                    </Button>
                                </form>

                                <div className="mt-6">
                                    <Link
                                        href="/auth/login"
                                        className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        <ArrowLeft className="h-4 w-4" />
                                        Back to sign in
                                    </Link>
                                </div>
                            </CardContent>
                        </>
                    ) : (
                        <>
                            <CardHeader className="space-y-1 text-center pb-4">
                                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/20 mx-auto mb-2">
                                    <CheckCircle className="h-7 w-7 text-primary" />
                                </div>
                                <CardTitle className="text-2xl font-bold text-card-foreground">Check your email</CardTitle>
                                <CardDescription>
                                    We sent a password reset link to
                                    <br />
                                    <span className="font-medium text-foreground">{email}</span>
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Button
                                    className="w-full"
                                    onClick={() => window.open("mailto:", "_blank")}
                                >
                                    Open email app
                                </Button>

                                <p className="text-center text-sm text-muted-foreground">
                                    Didn&apos;t receive the email?{" "}
                                    <button
                                        onClick={() => setIsSubmitted(false)}
                                        className="text-primary hover:text-primary/80 font-medium transition-colors"
                                    >
                                        Click to resend
                                    </button>
                                </p>

                                <div className="pt-2">
                                    <Link
                                        href="/auth/login"
                                        className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        <ArrowLeft className="h-4 w-4" />
                                        Back to sign in
                                    </Link>
                                </div>
                            </CardContent>
                        </>
                    )}
                </Card>

                {/* Footer */}
                <p className="mt-8 text-center text-xs text-muted-foreground">
                    Your personal cloud storage on Raspberry Pi
                </p>
            </div>
        </div>
    )
}
