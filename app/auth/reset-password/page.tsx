"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Cloud, Eye, EyeOff, Loader2, Check, X, KeyRound, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const passwordRequirements = [
    { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
    { label: "One uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
    { label: "One lowercase letter", test: (p: string) => /[a-z]/.test(p) },
    { label: "One number", test: (p: string) => /\d/.test(p) },
]

export default function ResetPasswordPage() {
    const router = useRouter()
    const [isLoading, setIsLoading] = useState(false)
    const [isReset, setIsReset] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)
    const [formData, setFormData] = useState({
        password: "",
        confirmPassword: "",
    })

    const passwordStrength = passwordRequirements.filter((req) => req.test(formData.password)).length
    const passwordsMatch = formData.password === formData.confirmPassword && formData.confirmPassword !== ""

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (passwordStrength < passwordRequirements.length || !passwordsMatch) {
            return
        }

        setIsLoading(true)

        // Simulate password reset - replace with actual logic
        await new Promise((resolve) => setTimeout(resolve, 1500))

        setIsReset(true)
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
                    {!isReset ? (
                        <>
                            <CardHeader className="space-y-1 text-center pb-4">
                                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/20 mx-auto mb-2">
                                    <KeyRound className="h-7 w-7 text-primary" />
                                </div>
                                <CardTitle className="text-2xl font-bold text-card-foreground">Set new password</CardTitle>
                                <CardDescription>
                                    Your new password must be different from previously used passwords
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="password" className="text-sm font-medium text-card-foreground">
                                            New Password
                                        </Label>
                                        <div className="relative">
                                            <Input
                                                id="password"
                                                type={showPassword ? "text" : "password"}
                                                placeholder="••••••••"
                                                value={formData.password}
                                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                                className="bg-secondary border-border pr-10"
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

                                        {/* Password Requirements */}
                                        {formData.password && (
                                            <div className="mt-2 space-y-1">
                                                {passwordRequirements.map((req, index) => {
                                                    const passed = req.test(formData.password)
                                                    return (
                                                        <div key={index} className="flex items-center gap-2 text-xs">
                                                            {passed ? (
                                                                <Check className="h-3 w-3 text-primary" />
                                                            ) : (
                                                                <X className="h-3 w-3 text-muted-foreground" />
                                                            )}
                                                            <span className={cn(
                                                                passed ? "text-primary" : "text-muted-foreground"
                                                            )}>
                                                                {req.label}
                                                            </span>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="confirmPassword" className="text-sm font-medium text-card-foreground">
                                            Confirm New Password
                                        </Label>
                                        <div className="relative">
                                            <Input
                                                id="confirmPassword"
                                                type={showConfirmPassword ? "text" : "password"}
                                                placeholder="••••••••"
                                                value={formData.confirmPassword}
                                                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                                className={cn(
                                                    "bg-secondary border-border pr-10",
                                                    formData.confirmPassword && !passwordsMatch && "border-destructive"
                                                )}
                                                required
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                            >
                                                {showConfirmPassword ? (
                                                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <Eye className="h-4 w-4 text-muted-foreground" />
                                                )}
                                            </Button>
                                        </div>
                                        {formData.confirmPassword && !passwordsMatch && (
                                            <p className="text-xs text-destructive">Passwords do not match</p>
                                        )}
                                    </div>

                                    <Button
                                        type="submit"
                                        className="w-full gap-2"
                                        disabled={isLoading || passwordStrength < passwordRequirements.length || !passwordsMatch}
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Resetting password...
                                            </>
                                        ) : (
                                            "Reset password"
                                        )}
                                    </Button>
                                </form>
                            </CardContent>
                        </>
                    ) : (
                        <>
                            <CardHeader className="space-y-1 text-center pb-4">
                                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/20 mx-auto mb-2">
                                    <CheckCircle className="h-7 w-7 text-primary" />
                                </div>
                                <CardTitle className="text-2xl font-bold text-card-foreground">Password reset</CardTitle>
                                <CardDescription>
                                    Your password has been successfully reset.
                                    <br />
                                    Click below to sign in with your new password.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Button
                                    className="w-full"
                                    onClick={() => router.push("/auth/login")}
                                >
                                    Continue to sign in
                                </Button>
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
