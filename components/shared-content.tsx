"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Folder, FileText, MoreVertical, Link2, Eye, Edit3 } from "lucide-react"

const sharedItems = [
  {
    id: "1",
    name: "Project Assets",
    type: "folder",
    sharedWith: [
      { name: "Alice", avatar: "A" },
      { name: "Bob", avatar: "B" },
      { name: "Carol", avatar: "C" },
    ],
    permission: "edit",
    sharedDate: "2 days ago",
  },
  {
    id: "2",
    name: "Design System.pdf",
    type: "file",
    sharedWith: [
      { name: "David", avatar: "D" },
      { name: "Eve", avatar: "E" },
    ],
    permission: "view",
    sharedDate: "1 week ago",
  },
  {
    id: "3",
    name: "Marketing Materials",
    type: "folder",
    sharedWith: [{ name: "Frank", avatar: "F" }],
    permission: "edit",
    sharedDate: "2 weeks ago",
  },
  {
    id: "4",
    name: "Q4 Report.xlsx",
    type: "file",
    sharedWith: [
      { name: "Grace", avatar: "G" },
      { name: "Henry", avatar: "H" },
      { name: "Ivy", avatar: "I" },
      { name: "Jack", avatar: "J" },
    ],
    permission: "view",
    sharedDate: "3 weeks ago",
  },
]

export function SharedContent() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Shared Files</h1>
          <p className="text-muted-foreground">Files and folders you've shared with others</p>
        </div>
        <Button className="gap-2">
          <Link2 className="h-4 w-4" />
          Create Share Link
        </Button>
      </div>

      <div className="grid gap-4">
        {sharedItems.map((item) => (
          <Card key={item.id} className="bg-card border-border">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-secondary p-3">
                  {item.type === "folder" ? (
                    <Folder className="h-6 w-6 text-blue-400" />
                  ) : (
                    <FileText className="h-6 w-6 text-red-400" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-card-foreground">{item.name}</p>
                  <p className="text-sm text-muted-foreground">Shared {item.sharedDate}</p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {item.sharedWith.slice(0, 3).map((user, index) => (
                      <Avatar key={index} className="h-8 w-8 border-2 border-card">
                        <AvatarImage src={`/.jpg?height=32&width=32&query=${user.name} avatar`} />
                        <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                          {user.avatar}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                    {item.sharedWith.length > 3 && (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-card bg-secondary text-xs font-medium text-secondary-foreground">
                        +{item.sharedWith.length - 3}
                      </div>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {item.sharedWith.length} {item.sharedWith.length === 1 ? "person" : "people"}
                  </span>
                </div>

                <Badge
                  variant="secondary"
                  className={
                    item.permission === "edit"
                      ? "bg-primary/20 text-primary border-0"
                      : "bg-secondary text-secondary-foreground"
                  }
                >
                  {item.permission === "edit" ? <Edit3 className="mr-1 h-3 w-3" /> : <Eye className="mr-1 h-3 w-3" />}
                  Can {item.permission}
                </Badge>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>Manage Access</DropdownMenuItem>
                    <DropdownMenuItem>Copy Link</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive">Stop Sharing</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
