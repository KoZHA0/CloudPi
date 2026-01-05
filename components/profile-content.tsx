"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Camera, Key, Shield } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export function ProfileContent() {
  return (
    <div className="space-y-6 max-w-4xl">
      <Card className="bg-card border-border">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <div className="relative">
              <Avatar className="h-24 w-24">
                <AvatarImage src="/diverse-user-avatars.png" />
                <AvatarFallback className="text-2xl bg-primary text-primary-foreground">U</AvatarFallback>
              </Avatar>
              <Button size="icon" variant="secondary" className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full">
                <Camera className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-card-foreground">User</h2>
              <p className="text-muted-foreground mt-1">Personal Cloud Storage</p>
            </div>
            <Button>Edit Profile</Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {/* Personal Information - Simplified */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-card-foreground">Personal Information</CardTitle>
            <CardDescription>Update your profile details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input id="username" defaultValue="user" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email (for notifications)</Label>
              <Input id="email" type="email" defaultValue="user@localhost" />
            </div>
            <Button className="w-full sm:w-auto">Save Changes</Button>
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
                <Button variant="outline" size="sm">
                  Change
                </Button>
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
