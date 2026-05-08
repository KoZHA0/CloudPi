"use client"

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

const SESSION_TIMEOUT_MS = 15 * 60 * 1000
const TOUCH_THROTTLE_MS = 1000

type VaultSession = {
    dek: CryptoKey
    lastTouched: number
}

type VaultSessions = Record<number, VaultSession>

type VaultContextValue = {
    isVaultUnlocked: (vaultId: number | null | undefined) => boolean
    getVaultKey: (vaultId: number | null | undefined) => CryptoKey | null
    unlockVault: (vaultId: number, dek: CryptoKey) => void
    lockVault: (vaultId: number) => void
    touchVault: (vaultId: number | null | undefined) => void
}

const VaultContext = createContext<VaultContextValue | undefined>(undefined)

export function useVaults() {
    const context = useContext(VaultContext)
    if (!context) {
        throw new Error("useVaults must be used within VaultProvider")
    }
    return context
}

export function VaultProvider({ children }: { children: ReactNode }) {
    const [sessions, setSessions] = useState<VaultSessions>({})

    useEffect(() => {
        const timer = window.setInterval(() => {
            const now = Date.now()
            setSessions((current) => {
                let changed = false
                const next: VaultSessions = {}

                Object.entries(current).forEach(([vaultId, session]) => {
                    if (now - session.lastTouched < SESSION_TIMEOUT_MS) {
                        next[Number(vaultId)] = session
                    } else {
                        changed = true
                    }
                })

                return changed ? next : current
            })
        }, 60_000)

        return () => window.clearInterval(timer)
    }, [])

    const value = useMemo<VaultContextValue>(() => ({
        isVaultUnlocked(vaultId) {
            if (!vaultId) return false
            return Boolean(sessions[vaultId])
        },
        getVaultKey(vaultId) {
            if (!vaultId) return null
            return sessions[vaultId]?.dek || null
        },
        unlockVault(vaultId, dek) {
            setSessions((current) => ({
                ...current,
                [vaultId]: { dek, lastTouched: Date.now() },
            }))
        },
        lockVault(vaultId) {
            setSessions((current) => {
                if (!current[vaultId]) return current
                const next = { ...current }
                delete next[vaultId]
                return next
            })
        },
        touchVault(vaultId) {
            if (!vaultId) return
            setSessions((current) => {
                const existing = current[vaultId]
                if (!existing) return current
                const now = Date.now()
                if (now - existing.lastTouched < TOUCH_THROTTLE_MS) {
                    return current
                }
                return {
                    ...current,
                    [vaultId]: { ...existing, lastTouched: now },
                }
            })
        },
    }), [sessions])

    return (
        <VaultContext.Provider value={value}>
            {children}
        </VaultContext.Provider>
    )
}
