import { useState, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Cloud, Loader2, KeyRound, Eye, EyeOff, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { resetPasswordWithToken } from "@/lib/api"

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

export function ResetPasswordPage() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    
    const email = searchParams.get("email")
    const token = searchParams.get("token")

    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [formData, setFormData] = useState({
        newPassword: "",
        confirmPassword: "",
    })

    useEffect(() => {
        if (!email || !token) {
            setError("Invalid or missing password reset link.")
        }
    }, [email, token])

    const handleResetSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        if (!email || !token) {
            setError("Invalid link")
            return
        }

        if (formData.newPassword !== formData.confirmPassword) {
            setError("Passwords do not match")
            return
        }

        if (formData.newPassword.length < 6) {
            setError("Password must be at least 6 characters")
            return
        }

        setIsLoading(true)

        try {
            await resetPasswordWithToken(email, token, formData.newPassword)
            setSuccess(true)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Password reset failed")
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
                            Password Reset!
                        </CardTitle>
                        <CardDescription>
                            Your password has been successfully updated.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button
                            className="w-full"
                            onClick={() => navigate("/auth/login")}
                        >
                            Back to Login
                        </Button>
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
                        <KeyRound className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle className="text-2xl font-bold text-card-foreground">
                        Reset Password
                    </CardTitle>
                    <CardDescription>
                        Enter a new password for {email}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {error && (
                        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/50 text-destructive text-sm">
                            {error}
                        </div>
                    )}
                    <form onSubmit={handleResetSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="newPassword">New Password</Label>
                            <div className="relative">
                                <Input
                                    id="newPassword"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="••••••••"
                                    value={formData.newPassword}
                                    onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                                    className="pr-10"
                                    required
                                    disabled={!email || !token}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                                    onClick={() => setShowPassword(!showPassword)}
                                    disabled={!email || !token}
                                >
                                    {showPassword ? (
                                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <Eye className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="confirmPassword">Confirm New Password</Label>
                            <Input
                                id="confirmPassword"
                                type="password"
                                placeholder="••••••••"
                                value={formData.confirmPassword}
                                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                required
                                disabled={!email || !token}
                            />
                        </div>

                        <Button type="submit" className="w-full gap-2" disabled={isLoading || !email || !token}>
                            {isLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Resetting...
                                </>
                            ) : (
                                <>
                                    <KeyRound className="h-4 w-4" />
                                    Change Password
                                </>
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </PageWrapper>
    )
}
