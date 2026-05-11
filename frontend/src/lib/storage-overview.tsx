import { useState } from "react";
import { HardDrive, Loader2, Trash2 } from "lucide-react";
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
    onRefreshStats: () => void;
}

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
    onRefreshStats,
}: StorageOverviewProps) {
    const navigate = useNavigate();
    const [isEmptying, setIsEmptying] = useState(false);

    // Calculate usage percentage. Treat 0 or null quota as "Unlimited"
    const isUnlimited = storageQuota === null || storageQuota === 0;
    const usagePercentage = isUnlimited 
        ? 0 
        : Math.min(100, (totalStorage / (storageQuota as number)) * 100);

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
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-semibold flex items-center gap-2 text-card-foreground">
                        <HardDrive className="h-5 w-5 text-primary" />
                        Storage Usage
                    </CardTitle>
                </div>
                <CardDescription>
                    {isUnlimited ? "Unlimited storage plan" : `${formatBytes(storageQuota)} total quota`}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2 mt-2">
                    <div className="flex justify-between text-sm">
                        <span className="font-medium text-foreground">{formatBytes(totalStorage)} Used</span>
                        {!isUnlimited && (
                            <span className="text-muted-foreground font-medium">{usagePercentage.toFixed(1)}%</span>
                        )}
                    </div>
                    {!isUnlimited && (
                        <Progress value={usagePercentage} className="h-2" />
                    )}
                </div>

                {trashStorage > 0 && (
                    <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-full bg-amber-500/20 p-2">
                                <Trash2 className="h-5 w-5 text-amber-600" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-amber-600 dark:text-amber-500">Trash Bin</p>
                                <p className="text-xs text-amber-600/80 dark:text-amber-500/80">
                                    {trashFiles} files taking up {formatBytes(trashStorage)}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="shrink-0 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
                                onClick={() => navigate('/trash')}
                            >
                                Review Trash
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                className="shrink-0"
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
