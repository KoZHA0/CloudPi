"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
    Users,
    UserPlus,
    Shield,
    Trash2,
    Loader2,
    User as UserIcon,
    Check,
    X,
    KeyRound,
} from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { useAuth } from "@/contexts/auth-context"
import { getUsers, createUser, deleteUser, adminResetPassword, type User } from "@/lib/api"

export function AdminContent() {
    const { user: currentUser } = useAuth()
    const [users, setUsers] = useState<User[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    
    // Create user form state
    const [createDialogOpen, setCreateDialogOpen] = useState(false)
    const [isCreating, setIsCreating] = useState(false)
    const [createMessage, setCreateMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
    const [newUser, setNewUser] = useState({
        username: "",
        password: "",
        isAdmin: false,
    })

    // Reset password state
    const [resetDialogOpen, setResetDialogOpen] = useState(false)
    const [resetTargetUser, setResetTargetUser] = useState<User | null>(null)
    const [resetPassword, setResetPassword] = useState("")
    const [isResetting, setIsResetting] = useState(false)
    const [resetMessage, setResetMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

    const loadUsers = async () => {
        try {
            setIsLoading(true)
            const response = await getUsers()
            setUsers(response.users)
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load users")
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        loadUsers()
    }, [])

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsCreating(true)
        setCreateMessage(null)

        try {
            await createUser(newUser.username, newUser.password, newUser.isAdmin)
            setCreateMessage({ type: 'success', text: 'User created successfully!' })
            setNewUser({ username: "", password: "", isAdmin: false })
            loadUsers()
            setTimeout(() => setCreateDialogOpen(false), 1500)
        } catch (err) {
            setCreateMessage({ 
                type: 'error', 
                text: err instanceof Error ? err.message : 'Failed to create user' 
            })
        } finally {
            setIsCreating(false)
        }
    }

    const handleDeleteUser = async (userId: number) => {
        try {
            await deleteUser(userId)
            loadUsers()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete user")
        }
    }

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!resetTargetUser) return
        setIsResetting(true)
        setResetMessage(null)

        try {
            await adminResetPassword(resetTargetUser.id, resetPassword)
            setResetMessage({ type: 'success', text: `Password reset for ${resetTargetUser.username}!` })
            setResetPassword("")
            setTimeout(() => {
                setResetDialogOpen(false)
                setResetTargetUser(null)
            }, 1500)
        } catch (err) {
            setResetMessage({ 
                type: 'error', 
                text: err instanceof Error ? err.message : 'Failed to reset password' 
            })
        } finally {
            setIsResetting(false)
        }
    }

    const openResetDialog = (user: User) => {
        setResetTargetUser(user)
        setResetPassword("")
        setResetMessage(null)
        setResetDialogOpen(true)
    }

    // Check if current user can delete a specific user
    const canDeleteUser = (user: User): boolean => {
        if (!currentUser) return false
        if (user.id === currentUser.id) return false
        if (user.id === 1) return false
        if (user.is_admin && currentUser.id !== 1) return false
        return true
    }

    // Only super admin can reset passwords
    const canResetPassword = (user: User): boolean => {
        if (!currentUser) return false
        if (currentUser.id !== 1) return false // Only super admin
        if (user.id === currentUser.id) return false // Use profile page instead
        return true
    }

    if (!currentUser?.is_admin) {
        return (
            <div className="flex items-center justify-center h-[50vh]">
                <Card className="bg-card border-border p-8 text-center">
                    <Shield className="h-12 w-12 text-destructive mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-card-foreground">Access Denied</h2>
                    <p className="text-muted-foreground mt-2">You need admin privileges to access this page.</p>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6 max-w-4xl">
            <Card className="bg-card border-border">
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                            <CardTitle className="text-card-foreground flex items-center gap-2">
                                <Users className="h-5 w-5" />
                                User Management
                            </CardTitle>
                            <CardDescription>Manage users who can access CloudPi</CardDescription>
                        </div>
                        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                            <DialogTrigger asChild>
                                <Button className="gap-2">
                                    <UserPlus className="h-4 w-4" />
                                    Add User
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md">
                                <DialogHeader>
                                    <DialogTitle>Create New User</DialogTitle>
                                    <DialogDescription>
                                        Add a new user to CloudPi
                                    </DialogDescription>
                                </DialogHeader>
                                <form onSubmit={handleCreateUser} className="space-y-4 mt-4">
                                    {createMessage && (
                                        <div className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                                            createMessage.type === 'success' 
                                                ? 'bg-green-500/10 border border-green-500/50 text-green-400' 
                                                : 'bg-destructive/10 border border-destructive/50 text-destructive'
                                        }`}>
                                            {createMessage.type === 'success' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                                            {createMessage.text}
                                        </div>
                                    )}
                                    <div className="space-y-2">
                                        <Label htmlFor="new-username">Username</Label>
                                        <Input 
                                            id="new-username" 
                                            value={newUser.username}
                                            onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="new-password">Password</Label>
                                        <Input 
                                            id="new-password" 
                                            type="password"
                                            value={newUser.password}
                                            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Checkbox 
                                            id="is-admin"
                                            checked={newUser.isAdmin}
                                            onCheckedChange={(checked) => 
                                                setNewUser({ ...newUser, isAdmin: checked as boolean })
                                            }
                                        />
                                        <Label htmlFor="is-admin" className="text-sm font-normal cursor-pointer">
                                            Make this user an admin
                                        </Label>
                                    </div>
                                    <div className="flex justify-end gap-2">
                                        <Button 
                                            type="button" 
                                            variant="outline" 
                                            onClick={() => setCreateDialogOpen(false)}
                                        >
                                            Cancel
                                        </Button>
                                        <Button type="submit" disabled={isCreating}>
                                            {isCreating ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                    Creating...
                                                </>
                                            ) : (
                                                "Create User"
                                            )}
                                        </Button>
                                    </div>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </div>
                </CardHeader>
                <CardContent>
                    {error && (
                        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/50 text-destructive text-sm">
                            {error}
                        </div>
                    )}
                    
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {users.map((user) => (
                                <div 
                                    key={user.id} 
                                    className="flex items-center justify-between p-4 rounded-lg bg-secondary"
                                >
                                    <div className="flex items-center gap-4">
                                        <Avatar className="h-10 w-10">
                                            <AvatarFallback className="bg-primary text-primary-foreground">
                                                {user.username.charAt(0).toUpperCase()}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <p className="font-medium text-secondary-foreground">{user.username}</p>
                                                {user.is_admin ? (
                                                    <Badge className="bg-primary/20 text-primary">
                                                        <Shield className="h-3 w-3 mr-1" />
                                                        {user.id === 1 ? 'Super Admin' : 'Admin'}
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-muted-foreground">
                                                        <UserIcon className="h-3 w-3 mr-1" />
                                                        User
                                                    </Badge>
                                                )}
                                                {user.id === currentUser?.id && (
                                                    <Badge variant="secondary">You</Badge>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {canResetPassword(user) && (
                                            <Button 
                                                variant="ghost" 
                                                size="icon"
                                                className="text-amber-500 hover:text-amber-400"
                                                onClick={() => openResetDialog(user)}
                                                title="Reset Password"
                                            >
                                                <KeyRound className="h-4 w-4" />
                                            </Button>
                                        )}
                                        {canDeleteUser(user) && (
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Delete User</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            Are you sure you want to delete <strong>{user.username}</strong>? 
                                                            This action cannot be undone.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction 
                                                            onClick={() => handleDeleteUser(user.id)}
                                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                        >
                                                            Delete
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Reset Password Dialog */}
            <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Reset Password</DialogTitle>
                        <DialogDescription>
                            Set a new password for <strong>{resetTargetUser?.username}</strong>
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleResetPassword} className="space-y-4 mt-4">
                        {resetMessage && (
                            <div className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                                resetMessage.type === 'success' 
                                    ? 'bg-green-500/10 border border-green-500/50 text-green-400' 
                                    : 'bg-destructive/10 border border-destructive/50 text-destructive'
                            }`}>
                                {resetMessage.type === 'success' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                                {resetMessage.text}
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="reset-password">New Password</Label>
                            <Input 
                                id="reset-password" 
                                type="password"
                                placeholder="Enter new password (min 6 characters)"
                                value={resetPassword}
                                onChange={(e) => setResetPassword(e.target.value)}
                                required
                                minLength={6}
                            />
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button 
                                type="button" 
                                variant="outline" 
                                onClick={() => setResetDialogOpen(false)}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isResetting}>
                                {isResetting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Resetting...
                                    </>
                                ) : (
                                    "Reset Password"
                                )}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
