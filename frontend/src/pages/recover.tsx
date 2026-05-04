import { useState } from "react"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import { Cloud, Loader2, KeyRound, Eye, EyeOff, ShieldAlert, Copy, Check, ArrowLeft, User, ShieldX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { recoverWithCode, setToken } from "@/lib/api"
import { useAuth } from "@/contexts/auth-context"

const API_BASE = import.meta.env.VITE_API_URL || '/api';

type Step = 'username' | 'backup-code' | 'not-super-admin' | 'success'

// Defined OUTSIDE RecoverPage to avoid remounting on every state change
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

export function RecoverPage() {
    const navigate = useNavigate()
    const { updateUser } = useAuth()
    const [step, setStep] = useState<Step>('username')
    const [username, setUsername] = useState("")
    const [isChecking, setIsChecking] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showPassword, setShowPassword] = useState(false)
    const [newBackupCode, setNewBackupCode] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [formData, setFormData] = useState({
        backupCode: "",
        newPassword: "",
        confirmPassword: "",
    })

    const handleUsernameSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setIsChecking(true)

        try {
            const res = await fetch(`${API_BASE}/auth/check-recovery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username }),
            })
            const data = await res.json()

            if (!res.ok) {
                setError(data.error || 'User not found')
                return
            }

            if (data.canRecover) {
                setStep('backup-code')
            } else {
                setStep('not-super-admin')
            }
        } catch {
            setError('Could not connect to server')
        } finally {
            setIsChecking(false)
        }
    }

    const handleRecoverSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

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
            const response = await recoverWithCode(formData.backupCode, formData.newPassword)
            setToken(response.token)
            updateUser(response.user)
            setNewBackupCode(response.newBackupCode)
            setStep('success')
        } catch (err) {
            setError(err instanceof Error ? err.message : "Recovery failed")
        } finally {
            setIsLoading(false)
        }
    }

    const handleCopyCode = async () => {
        if (newBackupCode) {
            await navigator.clipboard.writeText(newBackupCode)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    // Step 1: Enter username
    if (step === 'username') {
        return (
            <PageWrapper>
                <Card className="border-border bg-card/80 backdrop-blur-xl shadow-2xl">
                    <CardHeader className="space-y-1 text-center pb-4">
                        <div className="flex justify-center mb-2">
                            <User className="h-8 w-8 text-primary" />
                        </div>
                        <CardTitle className="text-2xl font-bold text-card-foreground">
                            Account Recovery
                        </CardTitle>
                        <CardDescription>
                            Enter your username to start the recovery process
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {error && (
                            <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/50 text-destructive text-sm">
                                {error}
                            </div>
                        )}
                        <form onSubmit={handleUsernameSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="username">Username</Label>
                                <Input
                                    id="username"
                                    type="text"
                                    placeholder="Enter your username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                    autoFocus
                                />
                            </div>

                            <Button type="submit" className="w-full gap-2" disabled={isChecking}>
                                {isChecking ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Checking...
                                    </>
                                ) : (
                                    "Continue"
                                )}
                            </Button>

                            <div className="text-center">
                                <Link
                                    to="/auth/login"
                                    className="text-sm text-primary hover:text-primary/80 inline-flex items-center gap-1"
                                >
                                    <ArrowLeft className="h-3 w-3" />
                                    Back to Login
                                </Link>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            </PageWrapper>
        )
    }

    // Not super admin — show contact admin message
    if (step === 'not-super-admin') {
        return (
            <PageWrapper>
                <Card className="border-border bg-card/80 backdrop-blur-xl shadow-2xl">
                    <CardHeader className="space-y-1 text-center pb-4">
                        <div className="flex justify-center mb-2">
                            <ShieldX className="h-8 w-8 text-amber-500" />
                        </div>
                        <CardTitle className="text-2xl font-bold text-card-foreground">
                            Contact Your Admin
                        </CardTitle>
                        <CardDescription>
                            Password recovery via backup code is only available for the Super Admin account.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-center">
                            <p className="text-sm text-amber-400">
                                Please ask the <strong>Super Admin</strong> to reset your password from the Admin panel.
                            </p>
                        </div>

                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                className="flex-1 gap-2"
                                onClick={() => {
                                    setStep('username')
                                    setUsername("")
                                    setError(null)
                                }}
                            >
                                <ArrowLeft className="h-4 w-4" />
                                Try Again
                            </Button>
                            <Button
                                className="flex-1"
                                onClick={() => navigate("/auth/login")}
                            >
                                Back to Login
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </PageWrapper>
        )
    }

    // Step: Success — show new backup code
    if (step === 'success' && newBackupCode) {
        return (
            <PageWrapper>
                <Card className="border-border bg-card/80 backdrop-blur-xl shadow-2xl">
                    <CardHeader className="space-y-1 text-center pb-4">
                        <div className="flex justify-center mb-2">
                            <ShieldAlert className="h-8 w-8 text-amber-500" />
                        </div>
                        <CardTitle className="text-2xl font-bold text-card-foreground">
                            Password Reset Successful!
                        </CardTitle>
                        <CardDescription>
                            Here's your new backup code. Save it somewhere safe!
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="relative p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                            <p className="text-center font-mono text-2xl font-bold tracking-widest text-amber-500">
                                {newBackupCode}
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
                            Your old backup code no longer works. Use this new code if you need to reset your password again.
                        </p>

                        <Button
                            className="w-full"
                            onClick={() => navigate("/")}
                        >
                            Continue to Dashboard
                        </Button>
                    </CardContent>
                </Card>
            </PageWrapper>
        )
    }

    // Step 2: Backup code + new password (only for super admin)
    return (
        <PageWrapper>
            <Card className="border-border bg-card/80 backdrop-blur-xl shadow-2xl">
                <CardHeader className="space-y-1 text-center pb-4">
                    <div className="flex justify-center mb-2">
                        <KeyRound className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle className="text-2xl font-bold text-card-foreground">
                        Enter Backup Code
                    </CardTitle>
                    <CardDescription>
                        Enter your backup code and choose a new password
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {error && (
                        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/50 text-destructive text-sm">
                            {error}
                        </div>
                    )}
                    <form onSubmit={handleRecoverSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="backupCode">Backup Code</Label>
                            <Input
                                id="backupCode"
                                type="text"
                                placeholder="XXXX-XXXX-XXXX"
                                value={formData.backupCode}
                                onChange={(e) => setFormData({ ...formData, backupCode: e.target.value.toUpperCase() })}
                                className="font-mono text-center tracking-widest text-lg"
                                required
                                autoFocus
                            />
                        </div>

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
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                                    onClick={() => setShowPassword(!showPassword)}
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
                            />
                        </div>

                        <Button type="submit" className="w-full gap-2" disabled={isLoading}>
                            {isLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Recovering...
                                </>
                            ) : (
                                <>
                                    <KeyRound className="h-4 w-4" />
                                    Reset Password
                                </>
                            )}
                        </Button>

                        <div className="text-center">
                            <button
                                type="button"
                                onClick={() => {
                                    setStep('username')
                                    setUsername("")
                                    setError(null)
                                    setFormData({ backupCode: "", newPassword: "", confirmPassword: "" })
                                }}
                                className="text-sm text-primary hover:text-primary/80 inline-flex items-center gap-1"
                            >
                                <ArrowLeft className="h-3 w-3" />
                                Start Over
                            </button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </PageWrapper>
    )
}
