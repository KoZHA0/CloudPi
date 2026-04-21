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
    HardDrive,
    Usb,
    RefreshCw,
    Plug,
    Unplug,
    AlertTriangle,
    CircleDot,
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { useAuth } from "@/contexts/auth-context"
import { 
    getUsers, 
    createUser, 
    deleteUser, 
    adminResetPassword,
    getStorageSources,
    updateUserStorage,
    scanDrives,
    mountDrive,
    unmountDrive,
    addStorageSource,
    removeStorageSource,
    type User,
    type StorageSource,
    type DetectedDrive,
    type RegisteredSource,
} from "@/lib/api"

export function AdminContent() {
    const { user: currentUser } = useAuth()
    const [users, setUsers] = useState<User[]>([])
    const [storageSources, setStorageSources] = useState<StorageSource[]>([])
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

    // Drive management state
    const [detectedDrives, setDetectedDrives] = useState<DetectedDrive[]>([])
    const [registeredDriveSources, setRegisteredDriveSources] = useState<RegisteredSource[]>([])
    const [isScanning, setIsScanning] = useState(false)
    const [mountingDevice, setMountingDevice] = useState<string | null>(null)
    const [unmountingDevice, setUnmountingDevice] = useState<string | null>(null)
    const [driveMessage, setDriveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
    const [platformMessage, setPlatformMessage] = useState<string | null>(null)
    const [registeringDevice, setRegisteringDevice] = useState<string | null>(null)

    const loadUsers = async () => {
        try {
            setIsLoading(true)
            const [usersRes, storageRes] = await Promise.all([
                getUsers(),
                getStorageSources().catch(() => ({ sources: [] }))
            ])
            setUsers(usersRes.users)
            setStorageSources(storageRes.sources)
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

    const handleStorageChange = async (userId: number, storageId: string) => {
        try {
            await updateUserStorage(userId, storageId)
            // Optionally could show a success toast here
            setUsers(users.map(u => u.id === userId ? { ...u, default_storage_id: storageId } : u))
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to assign storage")
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

    // ===== Drive Management Handlers =====

    const handleScanDrives = async () => {
        setIsScanning(true)
        setDriveMessage(null)
        setPlatformMessage(null)
        try {
            const result = await scanDrives()
            setDetectedDrives(result.drives)
            setRegisteredDriveSources(result.registeredSources)
            if (result.message) {
                setPlatformMessage(result.message)
            }
            if (result.drives.length === 0 && !result.message) {
                setDriveMessage({ type: 'success', text: 'Scan complete. No removable drives detected.' })
            }
        } catch (err) {
            setDriveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to scan drives' })
        } finally {
            setIsScanning(false)
        }
    }

    const handleMount = async (device: string) => {
        setMountingDevice(device)
        setDriveMessage(null)
        try {
            const result = await mountDrive(device)
            setDriveMessage({ type: 'success', text: result.message })
            // Rescan to refresh the state
            await handleScanDrives()
        } catch (err) {
            setDriveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to mount drive' })
        } finally {
            setMountingDevice(null)
        }
    }

    const handleUnmount = async (device: string) => {
        setUnmountingDevice(device)
        setDriveMessage(null)
        try {
            const result = await unmountDrive(device)
            setDriveMessage({ type: 'success', text: result.message })
            // Rescan to refresh the state
            await handleScanDrives()
        } catch (err) {
            setDriveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to unmount drive' })
        } finally {
            setUnmountingDevice(null)
        }
    }

    const handleRegister = async (drive: DetectedDrive) => {
        if (!drive.mountpoint) return
        setRegisteringDevice(drive.device)
        setDriveMessage(null)
        try {
            const label = drive.label || drive.model || `USB Drive (${drive.name})`
            await addStorageSource(drive.mountpoint, label)
            setDriveMessage({ type: 'success', text: `"${label}" registered as storage source!` })
            // Rescan drives + reload storage sources
            await Promise.all([handleScanDrives(), loadUsers()])
        } catch (err) {
            setDriveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to register drive' })
        } finally {
            setRegisteringDevice(null)
        }
    }

    const handleRemoveStorage = async (id: string, label: string) => {
        if (!confirm(`Are you sure you want to unregister "${label}"? This will not delete any files on the drive, but it can no longer be used by CloudPi.`)) return
        
        setDriveMessage(null)
        try {
            const result = await removeStorageSource(id)
            setDriveMessage({ type: 'success', text: result.message })
            // Refresh
            await Promise.all([handleScanDrives(), loadUsers()])
        } catch (err) {
            setDriveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove storage source' })
        }
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
                                    <div className="flex items-center gap-4">
                                        <div className="w-[140px] hidden sm:block">
                                            <Select 
                                                value={user.default_storage_id || 'internal'} 
                                                onValueChange={(val) => handleStorageChange(user.id, val)}
                                            >
                                                <SelectTrigger className="h-8 text-xs">
                                                    <SelectValue placeholder="Select storage" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {storageSources.map(source => (
                                                        <SelectItem key={source.id} value={source.id} className="text-xs">
                                                            {source.label}
                                                        </SelectItem>
                                                    ))}
                                                    {storageSources.length === 0 && (
                                                        <SelectItem value={user.default_storage_id || 'internal'} className="text-xs">
                                                            Internal Storage
                                                        </SelectItem>
                                                    )}
                                                </SelectContent>
                                            </Select>
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
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Storage Manager — Super Admin only */}
            {currentUser?.id === 1 && (
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <HardDrive className="h-5 w-5" />
                                    Storage Manager
                                </CardTitle>
                                <CardDescription>Detect, mount, and manage USB drives</CardDescription>
                            </div>
                            <Button
                                variant="outline"
                                className="gap-2"
                                onClick={handleScanDrives}
                                disabled={isScanning}
                            >
                                {isScanning ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <RefreshCw className="h-4 w-4" />
                                )}
                                Scan Drives
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Drive message */}
                        {driveMessage && (
                            <div className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                                driveMessage.type === 'success'
                                    ? 'bg-green-500/10 border border-green-500/50 text-green-400'
                                    : 'bg-destructive/10 border border-destructive/50 text-destructive'
                            }`}>
                                {driveMessage.type === 'success' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                                {driveMessage.text}
                            </div>
                        )}

                        {/* Platform message */}
                        {platformMessage && (
                            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/50 text-amber-400 flex items-center gap-2 text-sm">
                                <AlertTriangle className="h-4 w-4" />
                                {platformMessage}
                            </div>
                        )}

                        {/* Detected Drives */}
                        {detectedDrives.length > 0 && (
                            <div className="space-y-3">
                                <h4 className="text-sm font-medium text-muted-foreground">Detected USB Drives</h4>
                                {detectedDrives.map((drive) => (
                                    <div
                                        key={drive.device}
                                        className="p-4 rounded-lg bg-secondary flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-primary/10">
                                                <Usb className="h-5 w-5 text-primary" />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="font-medium text-sm">{drive.label || drive.model}</p>
                                                    <Badge variant="outline" className="text-xs">{drive.device}</Badge>
                                                    {drive.fstype && (
                                                        <Badge
                                                            variant="outline"
                                                            className={`text-xs ${
                                                                drive.fstype === 'ntfs' || drive.fstype === 'ntfs3'
                                                                    ? 'border-amber-500/50 text-amber-400'
                                                                    : drive.fstype === 'ext4'
                                                                    ? 'border-green-500/50 text-green-400'
                                                                    : ''
                                                            }`}
                                                        >
                                                            {drive.fstype}
                                                        </Badge>
                                                    )}
                                                    {drive.isMounted && (
                                                        <Badge className="bg-green-500/20 text-green-400 text-xs">
                                                            <CircleDot className="h-3 w-3 mr-1" />Mounted
                                                        </Badge>
                                                    )}
                                                    {drive.isRegistered && (
                                                        <Badge className="bg-primary/20 text-primary text-xs">
                                                            <Check className="h-3 w-3 mr-1" />Registered
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    {drive.size} • {drive.model}
                                                    {drive.mountpoint && ` • ${drive.mountpoint}`}
                                                </p>
                                                {drive.fsWarning && (
                                                    <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                                                        <AlertTriangle className="h-3 w-3" />
                                                        {drive.fsWarning}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {!drive.isMounted ? (
                                                <Button
                                                    size="sm"
                                                    className="gap-1"
                                                    onClick={() => handleMount(drive.device)}
                                                    disabled={mountingDevice === drive.device}
                                                >
                                                    {mountingDevice === drive.device ? (
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                    ) : (
                                                        <Plug className="h-3 w-3" />
                                                    )}
                                                    Mount
                                                </Button>
                                            ) : (
                                                <>
                                                    {!drive.isRegistered && drive.mountpoint && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="gap-1"
                                                            onClick={() => handleRegister(drive)}
                                                            disabled={registeringDevice === drive.device}
                                                        >
                                                            {registeringDevice === drive.device ? (
                                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                            ) : (
                                                                <HardDrive className="h-3 w-3" />
                                                            )}
                                                            Register
                                                        </Button>
                                                    )}
                                                    <Button
                                                        size="sm"
                                                        variant="destructive"
                                                        className="gap-1"
                                                        onClick={() => handleUnmount(drive.device)}
                                                        disabled={unmountingDevice === drive.device}
                                                    >
                                                        {unmountingDevice === drive.device ? (
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                            <Unplug className="h-3 w-3" />
                                                        )}
                                                        Eject
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Registered Sources */}
                        {registeredDriveSources.length > 0 && (
                            <div className="space-y-3">
                                <h4 className="text-sm font-medium text-muted-foreground">Registered Storage Sources</h4>
                                {registeredDriveSources.map((src) => (
                                    <div
                                        key={src.id}
                                        className="p-3 rounded-lg bg-secondary/50 flex items-center justify-between"
                                    >
                                        <div className="flex items-center gap-3">
                                            <HardDrive className={`h-4 w-4 ${
                                                src.status === 'online' ? 'text-green-400' :
                                                src.status === 'offline' ? 'text-destructive' :
                                                'text-amber-400'
                                            }`} />
                                            <div>
                                                <p className="text-sm font-medium">{src.label}</p>
                                                <p className="text-xs text-muted-foreground">{src.path}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge
                                                variant="outline"
                                                className={`text-xs ${
                                                    src.status === 'online' ? 'border-green-500/50 text-green-400' :
                                                    src.status === 'offline' ? 'border-destructive/50 text-destructive' :
                                                    'border-amber-500/50 text-amber-400'
                                                }`}
                                            >
                                                {src.status === 'online' ? 'Online' :
                                                 src.status === 'offline' ? 'Offline (Unplugged)' :
                                                 'Detected'}
                                            </Badge>
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                                onClick={() => handleRemoveStorage(src.id, src.label)}
                                                title="Unregister storage source"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Empty state */}
                        {detectedDrives.length === 0 && registeredDriveSources.length === 0 && !isScanning && !platformMessage && (
                            <div className="text-center py-8 text-muted-foreground">
                                <Usb className="h-10 w-10 mx-auto mb-3 opacity-50" />
                                <p className="text-sm">Click "Scan Drives" to detect USB drives</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

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
