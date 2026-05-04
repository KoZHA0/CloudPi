"use client"

import { useEffect, useState } from "react"
import {
    Camera,
    Check,
    Copy,
    Key,
    Loader2,
    Shield,
    ShieldCheck,
    ShieldOff,
    X,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { changePassword, disable2FA, setup2FA, updateProfile, verify2FA } from "@/lib/api"
import { useAuth } from "@/contexts/auth-context"

type Message = { type: "success" | "error"; text: string }

function StatusMessage({ message }: { message: Message }) {
    return (
        <div
            className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                message.type === "success"
                    ? "bg-green-500/10 border border-green-500/50 text-green-400"
                    : "bg-destructive/10 border border-destructive/50 text-destructive"
            }`}
        >
            {message.type === "success" ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {message.text}
        </div>
    )
}

export function ProfileContent() {
    const { user, updateUser } = useAuth()

    const [username, setUsername] = useState(user?.username || "")
    const [email, setEmail] = useState(user?.email || "")
    const [profilePassword, setProfilePassword] = useState("")
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false)
    const [profileMessage, setProfileMessage] = useState<Message | null>(null)

    const [currentPassword, setCurrentPassword] = useState("")
    const [newPassword, setNewPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [isChangingPassword, setIsChangingPassword] = useState(false)
    const [passwordMessage, setPasswordMessage] = useState<Message | null>(null)
    const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)

    const [twoFactorDialogOpen, setTwoFactorDialogOpen] = useState(false)
    const [twoFactorSecret, setTwoFactorSecret] = useState("")
    const [twoFactorQrCode, setTwoFactorQrCode] = useState("")
    const [twoFactorCode, setTwoFactorCode] = useState("")
    const [isSettingUp2FA, setIsSettingUp2FA] = useState(false)
    const [isVerifying2FA, setIsVerifying2FA] = useState(false)
    const [isDisabling2FA, setIsDisabling2FA] = useState(false)
    const [disable2FADialogOpen, setDisable2FADialogOpen] = useState(false)
    const [disable2FAPassword, setDisable2FAPassword] = useState("")
    const [twoFactorCopied, setTwoFactorCopied] = useState(false)
    const [twoFactorMessage, setTwoFactorMessage] = useState<Message | null>(null)

    const twoFactorEnabled = user?.two_factor_enabled === 1
    const emailChanged = email.trim() !== (user?.email || "")

    useEffect(() => {
        setUsername(user?.username || "")
        setEmail(user?.email || "")
    }, [user?.username, user?.email])

    const handleProfileUpdate = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsUpdatingProfile(true)
        setProfileMessage(null)

        try {
            const response = await updateProfile(username, email, emailChanged ? profilePassword : undefined)
            updateUser(response.user)
            setProfilePassword("")
            setProfileMessage({ type: "success", text: "Profile updated successfully!" })
        } catch (error) {
            setProfileMessage({
                type: "error",
                text: error instanceof Error ? error.message : "Failed to update profile",
            })
        } finally {
            setIsUpdatingProfile(false)
        }
    }

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault()

        if (newPassword !== confirmPassword) {
            setPasswordMessage({ type: "error", text: "New passwords do not match" })
            return
        }

        if (newPassword.length < 6) {
            setPasswordMessage({ type: "error", text: "Password must be at least 6 characters" })
            return
        }

        setIsChangingPassword(true)
        setPasswordMessage(null)

        try {
            await changePassword(currentPassword, newPassword)
            setPasswordMessage({ type: "success", text: "Password changed successfully!" })
            setCurrentPassword("")
            setNewPassword("")
            setConfirmPassword("")
            setTimeout(() => setPasswordDialogOpen(false), 1500)
        } catch (error) {
            setPasswordMessage({
                type: "error",
                text: error instanceof Error ? error.message : "Failed to change password",
            })
        } finally {
            setIsChangingPassword(false)
        }
    }

    const handleStart2FASetup = async () => {
        setIsSettingUp2FA(true)
        setTwoFactorMessage(null)
        setTwoFactorCode("")

        try {
            const response = await setup2FA()
            setTwoFactorSecret(response.secret)
            setTwoFactorQrCode(response.qrCodeUrl)
            setTwoFactorDialogOpen(true)
        } catch (error) {
            setTwoFactorMessage({
                type: "error",
                text: error instanceof Error ? error.message : "Failed to start 2FA setup",
            })
        } finally {
            setIsSettingUp2FA(false)
        }
    }

    const handleVerify2FA = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsVerifying2FA(true)
        setTwoFactorMessage(null)

        try {
            const response = await verify2FA(twoFactorCode)
            updateUser(response.user)
            setTwoFactorMessage({ type: "success", text: response.message })
            setTwoFactorDialogOpen(false)
            setTwoFactorCode("")
            setTwoFactorSecret("")
            setTwoFactorQrCode("")
        } catch (error) {
            setTwoFactorMessage({
                type: "error",
                text: error instanceof Error ? error.message : "Failed to verify 2FA code",
            })
        } finally {
            setIsVerifying2FA(false)
        }
    }

    const handleDisable2FA = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsDisabling2FA(true)
        setTwoFactorMessage(null)

        try {
            const response = await disable2FA(disable2FAPassword)
            updateUser(response.user)
            setDisable2FAPassword("")
            setDisable2FADialogOpen(false)
            setTwoFactorMessage({ type: "success", text: response.message })
        } catch (error) {
            setTwoFactorMessage({
                type: "error",
                text: error instanceof Error ? error.message : "Failed to disable 2FA",
            })
        } finally {
            setIsDisabling2FA(false)
        }
    }

    const handleCopySecret = async () => {
        if (!twoFactorSecret) return
        await navigator.clipboard.writeText(twoFactorSecret)
        setTwoFactorCopied(true)
        setTimeout(() => setTwoFactorCopied(false), 2000)
    }

    return (
        <div className="space-y-6 max-w-4xl">
            <Card className="bg-card border-border">
                <CardContent className="pt-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                        <div className="relative">
                            <Avatar className="h-24 w-24">
                                <AvatarImage src="/diverse-user-avatars.png" />
                                <AvatarFallback className="text-2xl bg-primary text-primary-foreground">
                                    {user?.username?.charAt(0).toUpperCase() || "U"}
                                </AvatarFallback>
                            </Avatar>
                            <Button size="icon" variant="secondary" className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full">
                                <Camera className="h-4 w-4" />
                            </Button>
                        </div>
                        <div className="flex-1">
                            <h2 className="text-2xl font-bold text-card-foreground">{user?.username || "User"}</h2>
                            <p className="text-muted-foreground mt-1">{user?.is_admin ? "Administrator" : "User"}</p>
                            {user?.email && <p className="text-sm text-muted-foreground mt-1">{user.email}</p>}
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="space-y-6">
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-card-foreground">Personal Information</CardTitle>
                        <CardDescription>Update your profile details</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleProfileUpdate} className="space-y-4">
                            {profileMessage && <StatusMessage message={profileMessage} />}
                            <div className="space-y-2">
                                <Label htmlFor="username">Username</Label>
                                <Input
                                    id="username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="Enter username"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email Address</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="Enter email address"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Used for password reset and required before enabling two-factor authentication.
                                </p>
                            </div>
                            {emailChanged && (
                                <div className="space-y-2">
                                    <Label htmlFor="profile-current-password">Current Password</Label>
                                    <Input
                                        id="profile-current-password"
                                        type="password"
                                        value={profilePassword}
                                        onChange={(e) => setProfilePassword(e.target.value)}
                                        placeholder="Required to change email"
                                        required
                                    />
                                </div>
                            )}
                            <Button
                                type="submit"
                                className="w-full sm:w-auto"
                                disabled={isUpdatingProfile || (emailChanged && !profilePassword)}
                            >
                                {isUpdatingProfile ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    "Save Changes"
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-card-foreground">Security</CardTitle>
                        <CardDescription>Manage your account security settings</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {twoFactorMessage && <div className="mb-4"><StatusMessage message={twoFactorMessage} /></div>}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex items-center justify-between p-4 rounded-lg bg-secondary">
                                <div className="flex items-center gap-4">
                                    <div className="rounded-lg bg-primary/20 p-3">
                                        <Key className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-secondary-foreground">Password</p>
                                        <p className="text-sm text-muted-foreground">Change your password</p>
                                    </div>
                                </div>
                                <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button variant="outline" size="sm">Change</Button>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-md">
                                        <DialogHeader>
                                            <DialogTitle>Change Password</DialogTitle>
                                            <DialogDescription>
                                                Enter your current password and a new password.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <form onSubmit={handlePasswordChange} className="space-y-4 mt-4">
                                            {passwordMessage && <StatusMessage message={passwordMessage} />}
                                            <div className="space-y-2">
                                                <Label htmlFor="current-password">Current Password</Label>
                                                <Input
                                                    id="current-password"
                                                    type="password"
                                                    value={currentPassword}
                                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                                    required
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="new-password">New Password</Label>
                                                <Input
                                                    id="new-password"
                                                    type="password"
                                                    value={newPassword}
                                                    onChange={(e) => setNewPassword(e.target.value)}
                                                    required
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="confirm-password">Confirm New Password</Label>
                                                <Input
                                                    id="confirm-password"
                                                    type="password"
                                                    value={confirmPassword}
                                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                                    required
                                                />
                                            </div>
                                            <div className="flex justify-end gap-2">
                                                <Button type="button" variant="outline" onClick={() => setPasswordDialogOpen(false)}>
                                                    Cancel
                                                </Button>
                                                <Button type="submit" disabled={isChangingPassword}>
                                                    {isChangingPassword ? (
                                                        <>
                                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                            Changing...
                                                        </>
                                                    ) : (
                                                        "Change Password"
                                                    )}
                                                </Button>
                                            </div>
                                        </form>
                                    </DialogContent>
                                </Dialog>
                            </div>

                            <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-secondary">
                                <div className="flex items-center gap-4">
                                    <div className="rounded-lg bg-primary/20 p-3">
                                        <Shield className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-secondary-foreground">Two-Factor Auth</p>
                                        <p className="text-sm text-muted-foreground">
                                            {twoFactorEnabled ? "Authenticator app enabled" : "Protect your account with a code"}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <Badge
                                        variant="outline"
                                        className={twoFactorEnabled ? "text-green-400 border-green-500/50" : "text-muted-foreground"}
                                    >
                                        {twoFactorEnabled ? "Enabled" : "Disabled"}
                                    </Badge>
                                    {twoFactorEnabled ? (
                                        <Dialog open={disable2FADialogOpen} onOpenChange={setDisable2FADialogOpen}>
                                            <DialogTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={isDisabling2FA}
                                                    className="gap-2"
                                                >
                                                    <ShieldOff className="h-4 w-4" />
                                                    Disable
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent className="sm:max-w-md">
                                                <DialogHeader>
                                                    <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
                                                    <DialogDescription>
                                                        Enter your current password to turn off 2FA.
                                                    </DialogDescription>
                                                </DialogHeader>
                                                <form onSubmit={handleDisable2FA} className="space-y-4">
                                                    <div className="space-y-2">
                                                        <Label htmlFor="disable-2fa-password">Current Password</Label>
                                                        <Input
                                                            id="disable-2fa-password"
                                                            type="password"
                                                            value={disable2FAPassword}
                                                            onChange={(e) => setDisable2FAPassword(e.target.value)}
                                                            required
                                                        />
                                                    </div>
                                                    <DialogFooter>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            onClick={() => setDisable2FADialogOpen(false)}
                                                        >
                                                            Cancel
                                                        </Button>
                                                        <Button type="submit" disabled={isDisabling2FA || !disable2FAPassword}>
                                                            {isDisabling2FA ? (
                                                                <>
                                                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                                    Disabling...
                                                                </>
                                                            ) : (
                                                                "Disable 2FA"
                                                            )}
                                                        </Button>
                                                    </DialogFooter>
                                                </form>
                                            </DialogContent>
                                        </Dialog>
                                    ) : (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleStart2FASetup}
                                            disabled={isSettingUp2FA}
                                            className="gap-2"
                                        >
                                            {isSettingUp2FA ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                                            Enable
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={twoFactorDialogOpen} onOpenChange={setTwoFactorDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Set Up Two-Factor Authentication</DialogTitle>
                        <DialogDescription>
                            Scan the QR code with your authenticator app, then enter the 6-digit code.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleVerify2FA} className="space-y-4">
                        {twoFactorQrCode && (
                            <div className="flex justify-center rounded-lg bg-white p-4">
                                <img src={twoFactorQrCode} alt="Two-factor authentication QR code" className="h-48 w-48" />
                            </div>
                        )}
                        {twoFactorSecret && (
                            <div className="space-y-2">
                                <Label htmlFor="two-factor-secret">Manual setup key</Label>
                                <div className="flex gap-2">
                                    <Input id="two-factor-secret" value={twoFactorSecret} readOnly className="font-mono text-xs" />
                                    <Button type="button" variant="outline" size="icon" onClick={handleCopySecret}>
                                        {twoFactorCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="two-factor-code">Authentication code</Label>
                            <Input
                                id="two-factor-code"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                placeholder="123456"
                                value={twoFactorCode}
                                onChange={(e) => setTwoFactorCode(e.target.value)}
                                required
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setTwoFactorDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isVerifying2FA}>
                                {isVerifying2FA ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Verifying...
                                    </>
                                ) : (
                                    "Verify and Enable"
                                )}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
