import { useState } from "react"
import { Cloud, Loader2, Rocket, Copy, Check, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { setupAdmin, setToken } from "@/lib/api"
import { useAuth } from "@/contexts/auth-context"

export function SetupPage() {
    const { updateUser } = useAuth()
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [backupCode, setBackupCode] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [formData, setFormData] = useState({
        username: "",
        password: "",
        confirmPassword: "",
    })

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        if (formData.password !== formData.confirmPassword) {
            setError("Passwords do not match")
            return
        }

        if (formData.password.length < 6) {
            setError("Password must be at least 6 characters")
            return
        }

        setIsLoading(true)

        try {
            const response = await setupAdmin(formData.username, formData.password)
            setToken(response.token)
            updateUser(response.user)
            // Show backup code before proceeding
            setBackupCode(response.backupCode)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Setup failed")
        } finally {
            setIsLoading(false)
        }
    }

    const handleCopyCode = async () => {
        if (backupCode) {
            await navigator.clipboard.writeText(backupCode)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    const handleContinue = () => {
        window.location.href = "/"
    }

    // Show backup code screen after successful setup
    if (backupCode) {
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

                    <Card className="border-border bg-card/80 backdrop-blur-xl shadow-2xl">
                        <CardHeader className="space-y-1 text-center pb-4">
                            <div className="flex justify-center mb-2">
                                <ShieldAlert className="h-8 w-8 text-amber-500" />
                            </div>
                            <CardTitle className="text-2xl font-bold text-card-foreground">
                                Save Your Backup Code
                            </CardTitle>
                            <CardDescription>
                                This is your recovery code for password reset. Save it somewhere safe — you won't see it again!
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="relative p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                <p className="text-center font-mono text-2xl font-bold tracking-widest text-amber-500">
                                    {backupCode}
                                </p>
                            </div>

                            <Button
                                variant="outline"
                                className="w-full gap-2"
                                onClick={handleCopyCode}
                            >
                                {copied ? (
                                    <>
                                        <Check className="h-4 w-4 text-green-500" />
                                        Copied!
                                    </>
                                ) : (
                                    <>
                                        <Copy className="h-4 w-4" />
                                        Copy to Clipboard
                                    </>
                                )}
                            </Button>

                            <p className="text-xs text-muted-foreground text-center">
                                Use this code on the login page if you forget your password. A new code will be generated after each use.
                            </p>

                            <Button
                                className="w-full gap-2"
                                onClick={handleContinue}
                            >
                                <Rocket className="h-4 w-4" />
                                I've Saved It — Continue to Dashboard
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        )
    }

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

                <Card className="border-border bg-card/80 backdrop-blur-xl shadow-2xl">
                    <CardHeader className="space-y-1 text-center pb-4">
                        <div className="flex justify-center mb-2">
                            <Rocket className="h-8 w-8 text-primary" />
                        </div>
                        <CardTitle className="text-2xl font-bold text-card-foreground">Welcome to CloudPi!</CardTitle>
                        <CardDescription>Create your admin account to get started</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {error && (
                            <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/50 text-destructive text-sm">
                                {error}
                            </div>
                        )}
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="username">Username</Label>
                                <Input
                                    id="username"
                                    placeholder="Admin"
                                    value={formData.username}
                                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password">Password</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    placeholder="••••••••"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="confirmPassword">Confirm Password</Label>
                                <Input
                                    id="confirmPassword"
                                    type="password"
                                    placeholder="••••••••"
                                    value={formData.confirmPassword}
                                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                    required
                                />
                            </div>

                            <Button type="submit" className="w-full gap-2" disabled={isLoading}>
                                {isLoading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Creating Admin Account...
                                    </>
                                ) : (
                                    <>
                                        <Rocket className="h-4 w-4" />
                                        Create Admin Account
                                    </>
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <p className="mt-8 text-center text-xs text-muted-foreground">
                    This setup page only appears once when no users exist
                </p>
            </div>
        </div>
    )
}
