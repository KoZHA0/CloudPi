"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { 
    Users, 
    UserPlus, 
    Trash2, 
    Loader2, 
    Check, 
    X,
    Shield,
    User as UserIcon
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
import { getUsers, createUser, deleteUser, type User } from "@/lib/api"

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
        email: "",
        password: "",
        isAdmin: false,
    })

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
            await createUser(newUser.username, newUser.email, newUser.password, newUser.isAdmin)
            setCreateMessage({ type: 'success', text: 'User created successfully!' })
            setNewUser({ username: "", email: "", password: "", isAdmin: false })
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

    // Check if current user can delete a specific user
    // Rules: 
    // - Cannot delete yourself
    // - Cannot delete Super Admin (id = 1)
    // - Only Super Admin can delete other admins
    // - Regular admins can only delete regular users
    const canDeleteUser = (user: User): boolean => {
        if (!currentUser) return false
        if (user.id === currentUser.id) return false // Can't delete yourself
        if (user.id === 1) return false // Can't delete Super Admin
        if (user.is_admin && currentUser.id !== 1) return false // Only Super Admin can delete admins
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
                                        <Label htmlFor="new-email">Email</Label>
                                        <Input 
                                            id="new-email" 
                                            type="email"
                                            value={newUser.email}
                                            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
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
                                            <p className="text-sm text-muted-foreground">{user.email}</p>
                                        </div>
                                    </div>
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
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
