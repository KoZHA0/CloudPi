import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { HardDrive, FileText, ImageIcon, Video, Music, Download, Upload } from "lucide-react"
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts"

const storageData = [
    { name: "Jan", usage: 45 },
    { name: "Feb", usage: 52 },
    { name: "Mar", usage: 48 },
    { name: "Apr", usage: 61 },
    { name: "May", usage: 55 },
    { name: "Jun", usage: 68 },
]

const stats = [
    { name: "Total Storage", value: "68.4 GB", icon: HardDrive, subtext: "of 128 GB" },
    { name: "Documents", value: "2,847", icon: FileText, subtext: "files" },
    { name: "Images", value: "1,234", icon: ImageIcon, subtext: "files" },
    { name: "Videos", value: "156", icon: Video, subtext: "files" },
]

const recentFiles = [
    { name: "Project Proposal.pdf", type: "PDF", size: "2.4 MB", date: "2 hours ago" },
    { name: "Design Assets.zip", type: "Archive", size: "156 MB", date: "5 hours ago" },
    { name: "Meeting Notes.docx", type: "Document", size: "84 KB", date: "Yesterday" },
    { name: "Brand Guidelines.pdf", type: "PDF", size: "12 MB", date: "2 days ago" },
    { name: "Product Photos", type: "Folder", size: "2.1 GB", date: "3 days ago" },
]

const quickAccess = [
    { name: "Documents", icon: FileText, count: 2847, color: "text-blue-400" },
    { name: "Images", icon: ImageIcon, count: 1234, color: "text-green-400" },
    { name: "Videos", icon: Video, count: 156, color: "text-red-400" },
    { name: "Music", icon: Music, count: 89, color: "text-yellow-400" },
]

export function DashboardContent() {
    return (
        <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {stats.map((stat) => (
                    <Card key={stat.name} className="bg-card border-border">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">{stat.name}</CardTitle>
                            <stat.icon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-card-foreground">{stat.value}</div>
                            <p className="text-xs text-muted-foreground">{stat.subtext}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Storage Usage Chart */}
                <Card className="lg:col-span-2 bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-card-foreground">Storage Usage</CardTitle>
                        <CardDescription>Your storage consumption over the last 6 months</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={storageData}>
                                    <defs>
                                        <linearGradient id="storageGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} />
                                    <YAxis
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: "#71717a", fontSize: 12 }}
                                        tickFormatter={(value) => `${value}GB`}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: "#27272a",
                                            border: "1px solid #3f3f46",
                                            borderRadius: "8px",
                                        }}
                                        labelStyle={{ color: "#fafafa" }}
                                    />
                                    <Area type="monotone" dataKey="usage" stroke="#10b981" strokeWidth={2} fill="url(#storageGradient)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Quick Access */}
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-card-foreground">Quick Access</CardTitle>
                        <CardDescription>Browse by file type</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {quickAccess.map((item) => (
                            <div
                                key={item.name}
                                className="flex items-center justify-between rounded-lg bg-secondary p-3 transition-colors hover:bg-secondary/80 cursor-pointer"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`rounded-lg bg-background p-2 ${item.color}`}>
                                        <item.icon className="h-5 w-5" />
                                    </div>
                                    <span className="font-medium text-secondary-foreground">{item.name}</span>
                                </div>
                                <span className="text-sm text-muted-foreground">{item.count}</span>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>

            {/* Activity and Recent Files */}
            <div className="grid gap-6 lg:grid-cols-2">
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-card-foreground">Activity</CardTitle>
                        <CardDescription>Recent activity on your cloud</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-4">
                            <div className="rounded-full bg-primary/20 p-2">
                                <Upload className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-card-foreground">Uploaded 5 files</p>
                                <p className="text-xs text-muted-foreground">2 hours ago</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="rounded-full bg-yellow-500/20 p-2">
                                <Download className="h-4 w-4 text-yellow-400" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-card-foreground">Downloaded Project Assets</p>
                                <p className="text-xs text-muted-foreground">Yesterday</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="rounded-full bg-primary/20 p-2">
                                <Upload className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-card-foreground">Uploaded backup archive</p>
                                <p className="text-xs text-muted-foreground">3 days ago</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Recent Files */}
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-card-foreground">Recent Files</CardTitle>
                        <CardDescription>Files you recently accessed</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {recentFiles.map((file) => (
                                <div
                                    key={file.name}
                                    className="flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-secondary cursor-pointer"
                                >
                                    <div className="flex items-center gap-3">
                                        <FileText className="h-8 w-8 text-muted-foreground" />
                                        <div>
                                            <p className="text-sm font-medium text-card-foreground">{file.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {file.type} · {file.size}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="text-xs text-muted-foreground">{file.date}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
