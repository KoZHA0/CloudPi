"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Camera, Key, Shield, Loader2, Check, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { useAuth } from "@/contexts/auth-context"
import { updateProfile, changePassword } from "@/lib/api"

export function ProfileContent() {
    const { user, updateUser } = useAuth()
    
    // Profile form state
    const [username, setUsername] = useState(user?.username || "")
    const [email, setEmail] = useState(user?.email || "")
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false)
    const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
    
    // Password form state
    const [currentPassword, setCurrentPassword] = useState("")
    const [newPassword, setNewPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [isChangingPassword, setIsChangingPassword] = useState(false)
    const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
    const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)

    const handleProfileUpdate = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsUpdatingProfile(true)
        setProfileMessage(null)

        try {
            const response = await updateProfile(username, email)
            updateUser(response.user)
            setProfileMessage({ type: 'success', text: 'Profile updated successfully!' })
        } catch (error) {
            setProfileMessage({ 
                type: 'error', 
                text: error instanceof Error ? error.message : 'Failed to update profile' 
            })
        } finally {
            setIsUpdatingProfile(false)
        }
    }

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault()
        
        if (newPassword !== confirmPassword) {
            setPasswordMessage({ type: 'error', text: 'New passwords do not match' })
            return
        }

        if (newPassword.length < 6) {
            setPasswordMessage({ type: 'error', text: 'Password must be at least 6 characters' })
            return
        }

        setIsChangingPassword(true)
        setPasswordMessage(null)

        try {
            await changePassword(currentPassword, newPassword)
            setPasswordMessage({ type: 'success', text: 'Password changed successfully!' })
            setCurrentPassword("")
            setNewPassword("")
            setConfirmPassword("")
            // Close dialog after success
            setTimeout(() => setPasswordDialogOpen(false), 1500)
        } catch (error) {
            setPasswordMessage({ 
                type: 'error', 
                text: error instanceof Error ? error.message : 'Failed to change password' 
            })
        } finally {
            setIsChangingPassword(false)
        }
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
                                    {user?.username?.charAt(0).toUpperCase() || 'U'}
                                </AvatarFallback>
                            </Avatar>
                            <Button size="icon" variant="secondary" className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full">
                                <Camera className="h-4 w-4" />
                            </Button>
                        </div>
                        <div className="flex-1">
                            <h2 className="text-2xl font-bold text-card-foreground">{user?.username || 'User'}</h2>
                            <p className="text-muted-foreground mt-1">{user?.email || 'No email'}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="space-y-6">
                {/* Personal Information */}
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-card-foreground">Personal Information</CardTitle>
                        <CardDescription>Update your profile details</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleProfileUpdate} className="space-y-4">
                            {profileMessage && (
                                <div className={`p-3 rounded-lg flex items-center gap-2 ${
                                    profileMessage.type === 'success' 
                                        ? 'bg-green-500/10 border border-green-500/50 text-green-400' 
                                        : 'bg-destructive/10 border border-destructive/50 text-destructive'
                                }`}>
                                    {profileMessage.type === 'success' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                                    {profileMessage.text}
                                </div>
                            )}
                            <div className="space-y-2">
                                <Label htmlFor="username">Username</Label>
                                <Input 
                                    id="username" 
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="Enter username"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input 
                                    id="email" 
                                    type="email" 
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="Enter email"
                                />
                            </div>
                            <Button type="submit" className="w-full sm:w-auto" disabled={isUpdatingProfile}>
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

                {/* Security */}
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-card-foreground">Security</CardTitle>
                        <CardDescription>Manage your account security settings</CardDescription>
                    </CardHeader>
                    <CardContent>
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
                                        <Button variant="outline" size="sm">
                                            Change
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-md">
                                        <DialogHeader>
                                            <DialogTitle>Change Password</DialogTitle>
                                            <DialogDescription>
                                                Enter your current password and a new password.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <form onSubmit={handlePasswordChange} className="space-y-4 mt-4">
                                            {passwordMessage && (
                                                <div className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                                                    passwordMessage.type === 'success' 
                                                        ? 'bg-green-500/10 border border-green-500/50 text-green-400' 
                                                        : 'bg-destructive/10 border border-destructive/50 text-destructive'
                                                }`}>
                                                    {passwordMessage.type === 'success' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                                                    {passwordMessage.text}
                                                </div>
                                            )}
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
                                                <Button 
                                                    type="button" 
                                                    variant="outline" 
                                                    onClick={() => setPasswordDialogOpen(false)}
                                                >
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
                            <div className="flex items-center justify-between p-4 rounded-lg bg-secondary">
                                <div className="flex items-center gap-4">
                                    <div className="rounded-lg bg-primary/20 p-3">
                                        <Shield className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-secondary-foreground">Two-Factor Auth</p>
                                        <p className="text-sm text-muted-foreground">Not configured</p>
                                    </div>
                                </div>
                                <Badge variant="outline" className="text-muted-foreground">
                                    Disabled
                                </Badge>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
