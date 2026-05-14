import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function normalizeApiTimestamp(value?: string | null): string | null {
    if (!value) return null
    const trimmed = String(value).trim()
    if (!trimmed) return null
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) return trimmed
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00Z`
    return `${trimmed.replace(" ", "T")}Z`
}

export function parseApiDate(value?: string | null): Date | null {
    const normalized = normalizeApiTimestamp(value)
    if (!normalized) return null
    const date = new Date(normalized)
    return Number.isFinite(date.getTime()) ? date : null
}

export function formatApiDate(value?: string | null, options?: Intl.DateTimeFormatOptions): string {
    const date = parseApiDate(value)
    if (!date) return "-"
    return date.toLocaleDateString(undefined, options)
}

export function formatApiDateTime(value?: string | null, options?: Intl.DateTimeFormatOptions): string {
    const date = parseApiDate(value)
    if (!date) return "-"
    return date.toLocaleString(undefined, options)
}
