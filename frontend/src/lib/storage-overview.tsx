import { useState } from "react";
import { Archive, CircleHelp, FileText, HardDrive, History, ImageIcon, Loader2, Music, Trash2, Video } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { emptyTrash } from "@/lib/api";

interface StorageOverviewProps {
    totalStorage: number;
    storageQuota: number | null;
    trashStorage: number;
    trashFiles: number;
    versionStorage?: number;
    typeBreakdown?: Record<string, { count: number; size: number }>;
    onRefreshStats: () => void;
}

const typeBreakdownConfig = [
    { key: "document", label: "Documents", icon: FileText, color: "bg-blue-500" },
    { key: "image", label: "Images", icon: ImageIcon, color: "bg-emerald-500" },
    { key: "video", label: "Videos", icon: Video, color: "bg-violet-500" },
    { key: "audio", label: "Audio", icon: Music, color: "bg-yellow-500" },
    { key: "archive", label: "Archives", icon: Archive, color: "bg-orange-500" },
    { key: "other", label: "Other", icon: CircleHelp, color: "bg-slate-500" },
];

// Utility to convert bytes to readable formats (KB, MB, GB, etc.)
export function formatBytes(bytes: number, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function StorageOverview({
    totalStorage,
    storageQuota,
    trashStorage,
    trashFiles,
    versionStorage = 0,
    typeBreakdown = {},
    onRefreshStats,
}: StorageOverviewProps) {
    const navigate = useNavigate();
    const [isEmptying, setIsEmptying] = useState(false);

    // Calculate usage percentage. Treat 0 or null quota as "Unlimited"
    const isUnlimited = storageQuota === null || storageQuota === 0;
    const usagePercentage = isUnlimited 
        ? 0 
        : Math.min(100, (totalStorage / (storageQuota as number)) * 100);
    const knownTypeKeys = new Set(typeBreakdownConfig.map((item) => item.key));
    const unknownTypeTotals = Object.entries(typeBreakdown).reduce((total, [key, value]) => {
        if (knownTypeKeys.has(key)) return total;
        return {
            size: total.size + (Number(value.size) || 0),
            count: total.count + (Number(value.count) || 0),
        };
    }, { size: 0, count: 0 });
    const breakdownRows = typeBreakdownConfig
        .map((item) => {
            const current = typeBreakdown[item.key] || { count: 0, size: 0 };
            const size = item.key === "other"
                ? (Number(current.size) || 0) + unknownTypeTotals.size
                : Number(current.size) || 0;
            const count = item.key === "other"
                ? (Number(current.count) || 0) + unknownTypeTotals.count
                : Number(current.count) || 0;
            return { ...item, size, count };
        })
        .filter((item) => item.size > 0 || item.count > 0);

    async function handleEmptyTrash() {
        if (isEmptying) return;
        setIsEmptying(true);
        try {
            await emptyTrash();
            onRefreshStats();
        } catch (error) {
            console.error("Failed to empty trash:", error);
        } finally {
            setIsEmptying(false);
        }
    }

    return (
        <Card className="border-border bg-card/80 backdrop-blur-sm shadow-sm">
            <CardHeader className="pb-2">
                <div className="flex min-w-0 items-start justify-between gap-3">
                    <CardTitle className="flex min-w-0 items-center gap-2 text-lg font-semibold text-card-foreground">
                        <HardDrive className="h-5 w-5 text-primary" />
                        <span className="truncate">Storage Usage</span>
                    </CardTitle>
                </div>
                <CardDescription>
                    {isUnlimited ? "Unlimited storage plan" : `${formatBytes(storageQuota)} total quota`}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2 mt-2">
                    <div className="flex flex-col gap-1 text-sm min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                        <span className="font-medium text-foreground">{formatBytes(totalStorage)} Used</span>
                        {!isUnlimited && (
                            <span className="text-muted-foreground font-medium">{usagePercentage.toFixed(1)}%</span>
                        )}
                    </div>
                    {!isUnlimited && (
                        <Progress value={usagePercentage} className="h-2" />
                    )}
                </div>

                {breakdownRows.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {breakdownRows.map((item) => {
                            const Icon = item.icon;
                            const percent = totalStorage > 0 ? Math.min(100, (item.size / totalStorage) * 100) : 0;
                            return (
                                <div key={item.key} className="rounded-lg border border-border bg-secondary/50 p-3">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span className="truncate text-sm font-medium text-card-foreground">{item.label}</span>
                                        </div>
                                        <span className="shrink-0 text-xs text-muted-foreground">{item.count}</span>
                                    </div>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-background">
                                        <div className={`h-full ${item.color}`} style={{ width: `${percent}%` }} />
                                    </div>
                                    <p className="mt-2 text-xs text-muted-foreground">{formatBytes(item.size)}</p>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
                        No files are using storage yet.
                    </div>
                )}

                {versionStorage > 0 && (
                    <div className="flex min-w-0 items-center justify-between rounded-lg border border-border bg-secondary/60 p-4">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="rounded-full bg-primary/10 p-2">
                                <History className="h-5 w-5 text-primary" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-card-foreground">Version History</p>
                                <p className="break-words text-xs text-muted-foreground">
                                    {formatBytes(versionStorage)} stored in archived versions
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {trashStorage > 0 && (
                    <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="rounded-full bg-amber-500/20 p-2">
                                <Trash2 className="h-5 w-5 text-amber-600" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-amber-600 dark:text-amber-500">Trash Bin</p>
                                <p className="break-words text-xs text-amber-600/80 dark:text-amber-500/80">
                                    {trashFiles} files taking up {formatBytes(trashStorage)}
                                </p>
                            </div>
                        </div>
                        <div className="grid w-full grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:w-auto">
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full shrink-0 border-amber-500/30 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400 sm:w-auto"
                                onClick={() => navigate('/trash')}
                            >
                                Review Trash
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                className="w-full shrink-0 sm:w-auto"
                                onClick={handleEmptyTrash}
                                disabled={isEmptying}
                            >
                                {isEmptying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Empty Trash
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
