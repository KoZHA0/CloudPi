"use client"

/**
 * DRIVE STATUS CONTEXT
 * ====================
 * Real-time drive connectivity state via Server-Sent Events (SSE).
 *
 * Subscribes to /api/events SSE stream and maintains a live map of
 * which storage drives are online/offline. Components can use the
 * `useDriveStatus()` hook to:
 *   - Check if a specific file is accessible
 *   - Get a list of disconnected drives
 *   - React to drive status changes in real-time
 *
 * The context also shows toast notifications when drives connect/disconnect.
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react"
import {
    subscribeToDriveEvents,
    type DriveStatusEvent,
    type SSEConnectedEvent,
} from "@/lib/api"
import type { FileItem } from "@/lib/api"

interface DriveInfo {
    source_id: string
    label: string
    status: "online" | "offline"
}

interface DriveStatusContextType {
    /** Map of storage source id → live availability info */
    drives: Map<string, DriveInfo>
    /** All currently unavailable storage sources */
    disconnectedDrives: DriveInfo[]
    /** Check if a file is accessible (its storage source is online) */
    isFileAccessible: (file: FileItem) => boolean
    /** Latest notification message (auto-clears after timeout) */
    notification: { type: "connect" | "disconnect"; source_id: string; label: string } | null
}

const DriveStatusContext = createContext<DriveStatusContextType>({
    drives: new Map(),
    disconnectedDrives: [],
    isFileAccessible: () => true,
    notification: null,
})

export function useDriveStatus() {
    return useContext(DriveStatusContext)
}

export function DriveStatusProvider({ children }: { children: React.ReactNode }) {
    const [drives, setDrives] = useState<Map<string, DriveInfo>>(new Map())
    const [notification, setNotification] = useState<DriveStatusContextType["notification"]>(null)
    const notificationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Show a notification and auto-clear after 5 seconds
    const showNotification = useCallback((type: "connect" | "disconnect", source_id: string, label: string) => {
        if (notificationTimeout.current) clearTimeout(notificationTimeout.current)
        setNotification({ type, source_id, label })
        notificationTimeout.current = setTimeout(() => setNotification(null), 5000)
    }, [])

    // Handle initial connection — receive current drive states
    const handleConnected = useCallback((data: SSEConnectedEvent) => {
        const newDrives = new Map<string, DriveInfo>()
        for (const drive of data.drives) {
            newDrives.set(drive.source_id, {
                source_id: drive.source_id,
                label: drive.label,
                status: drive.status,
            })
        }
        setDrives(newDrives)
    }, [])

    // Handle drive status change event
    const handleStatusChange = useCallback((data: DriveStatusEvent) => {
        setDrives(prev => {
            const updated = new Map(prev)
            updated.set(data.source_id, {
                source_id: data.source_id,
                label: data.label,
                status: data.status,
            })
            return updated
        })

        // Show notification
        if (data.status === "offline") {
            showNotification("disconnect", data.source_id, data.label)
        } else {
            showNotification("connect", data.source_id, data.label)
        }
    }, [showNotification])

    // Subscribe to SSE on mount
    useEffect(() => {
        const cleanup = subscribeToDriveEvents(handleStatusChange, handleConnected)
        return () => {
            cleanup()
            if (notificationTimeout.current) clearTimeout(notificationTimeout.current)
        }
    }, [handleStatusChange, handleConnected])

    // Compute disconnected drives list
    const disconnectedDrives = Array.from(drives.values()).filter(d => d.status === "offline")

    // Check if a file's storage source is accessible
    const isFileAccessible = useCallback((file: FileItem): boolean => {
        const sourceId = file.storage_source_id || "internal"

        // Use the SSE-tracked status if available
        const driveInfo = drives.get(sourceId)
        if (driveInfo) return driveInfo.status === "online"

        // Fall back to the is_accessible field from the API response
        if (file.is_accessible !== undefined) {
            return file.is_accessible === true || file.is_accessible === 1
        }

        // Default: assume accessible
        return true
    }, [drives])

    return (
        <DriveStatusContext.Provider value={{ drives, disconnectedDrives, isFileAccessible, notification }}>
            {children}
        </DriveStatusContext.Provider>
    )
}
