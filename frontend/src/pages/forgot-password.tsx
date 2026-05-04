import { useState } from "react"
import { Link } from "react-router-dom"
import { Cloud, Loader2, Mail, ArrowLeft, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { requestPasswordReset } from "@/lib/api"

function PageWrapper({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
            <div className="relative w-full max-w-md">
                <div className="flex items-center justify-center gap-3 mb-8">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/20">
                        <Cloud className="h-7 w-7 text-primary" />
                    </div>
                    <span className="text-2xl font-bold text-foreground">Cloud-Pi</span>
                </div>
                {children}
                <p className="mt-8 text-center text-xs text-muted-foreground">
                    Your personal cloud storage on Raspberry Pi
                </p>
            </div>
        </div>
    )
}

export function ForgotPasswordPage() {
    const [email, setEmail] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        if (!email) {
            setError("Please enter your email address")
            return
        }

        setIsLoading(true)

        try {
            await requestPasswordReset(email)
            setSuccess(true)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Request failed")
        } finally {
            setIsLoading(false)
        }
    }

    if (success) {
        return (
            <PageWrapper>
                <Card className="border-border bg-card/80 backdrop-blur-xl shadow-2xl">
                    <CardHeader className="space-y-1 text-center pb-4">
                        <div className="flex justify-center mb-2">
                            <CheckCircle2 className="h-8 w-8 text-green-500" />
                        </div>
                        <CardTitle className="text-2xl font-bold text-card-foreground">
                            Check Your Email
                        </CardTitle>
                        <CardDescription>
                            If that email matches an account, a reset link has been sent. It will expire in 1 hour.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Link to="/auth/login" className="w-full block">
                            <Button className="w-full">Back to Login</Button>
                        </Link>
                    </CardContent>
                </Card>
            </PageWrapper>
        )
    }

    return (
        <PageWrapper>
            <Card className="border-border bg-card/80 backdrop-blur-xl shadow-2xl">
                <CardHeader className="space-y-1 text-center pb-4">
                    <div className="flex justify-center mb-2">
                        <Mail className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle className="text-2xl font-bold text-card-foreground">
                        Forgot Password
                    </CardTitle>
                    <CardDescription>
                        Enter your email address to receive a password reset link
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {error && (
                        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/50 text-destructive text-sm">
                            {error}
                        </div>
                    )}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email Address</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="Enter your email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoFocus
                            />
                        </div>

                        <Button type="submit" className="w-full gap-2" disabled={isLoading}>
                            {isLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Sending...
                                </>
                            ) : (
                                "Send Reset Link"
                            )}
                        </Button>

                        <div className="flex items-center justify-between mt-4">
                            <Link
                                to="/auth/login"
                                className="text-sm text-primary hover:text-primary/80 inline-flex items-center gap-1"
                            >
                                <ArrowLeft className="h-3 w-3" />
                                Back to Login
                            </Link>
                            <Link
                                to="/auth/recover"
                                className="text-sm text-muted-foreground hover:text-primary/80"
                            >
                                Admin Backup Code?
                            </Link>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </PageWrapper>
    )
}
