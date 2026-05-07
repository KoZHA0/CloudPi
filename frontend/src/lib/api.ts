/**
 * API UTILITY
 * ===========
 * Central place for all API calls to the backend
 */

// Use relative path - Vite proxy forwards /api to the backend
const API_BASE = '/api';

export function getToken(): string | null {
    return localStorage.getItem('cloudpi_token');
}

export function setToken(token: string): void {
    localStorage.setItem('cloudpi_token', token);
}

export function removeToken(): void {
    localStorage.removeItem('cloudpi_token');
}

async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const token = getToken();

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    // Safely parse JSON — if the server returns non-JSON (e.g. HTML error page,
    // empty body, or proxy error), show a human-readable message instead of
    // crashing with "JSON.parse: unexpected character at line 1 column 1"
    let data: any;
    try {
        const text = await response.text();
        data = JSON.parse(text);
    } catch {
        // Non-JSON response — server likely crashed or returned an error page
        if (response.status === 502 || response.status === 503) {
            throw new Error('Server is temporarily unavailable. Please try again in a moment.');
        }
        if (response.status === 504) {
            throw new Error('Server took too long to respond. The storage drive may be inaccessible.');
        }
        throw new Error(
            `Server error (${response.status}): The server returned an unexpected response. ` +
            'This often happens when an external storage drive is disconnected.'
        );
    }

    if (!response.ok) {
        throw new Error(data.error || 'API request failed');
    }

    return data;
}

// ============================================
// AUTH API
// ============================================

export interface User {
    id: number;
    username: string;
    email?: string | null;
    is_admin?: number;
    is_disabled?: number;
    failed_login_attempts?: number;
    locked_until?: string | null;
    default_storage_id?: string;
    storage_quota?: number | null;
    used_bytes?: number;
    two_factor_enabled?: number;
    avatar_url?: string | null;
}

export interface AuthenticatedResponse {
    message: string;
    token: string;
    user: User;
    requires_2fa?: false;
}

export interface TwoFactorRequiredResponse {
    message: string;
    requires_2fa: true;
    temp_token: string;
}

export type AuthResponse = AuthenticatedResponse | TwoFactorRequiredResponse;

export interface SetupResponse extends AuthenticatedResponse {
    backupCode: string;
}

export interface RecoverResponse {
    message: string;
    token: string;
    newBackupCode: string;
    user: User;
}

// Setup API
export async function getSetupStatus(): Promise<{ setupRequired: boolean; userCount: number }> {
    return apiRequest<{ setupRequired: boolean; userCount: number }>('/auth/setup-status');
}

export async function setupAdmin(
    username: string,
    password: string
): Promise<SetupResponse> {
    return apiRequest<SetupResponse>('/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    });
}

export async function login(
    username: string,
    password: string
): Promise<AuthResponse> {
    return apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    });
}

export async function recoverWithCode(
    backupCode: string,
    newPassword: string
): Promise<RecoverResponse> {
    return apiRequest<RecoverResponse>('/auth/recover', {
        method: 'POST',
        body: JSON.stringify({ backupCode, newPassword }),
    });
}

export async function getCurrentUser(): Promise<{ user: User }> {
    return apiRequest<{ user: User }>('/auth/me');
}

export function isLoggedIn(): boolean {
    return !!getToken();
}

// ============================================
// PROFILE API
// ============================================

export interface ProfileUpdateResponse {
    message: string;
    user: User;
}

export async function updateProfile(
    username: string,
    email?: string,
    currentPassword?: string
): Promise<ProfileUpdateResponse> {
    return apiRequest<ProfileUpdateResponse>('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ username, email, currentPassword }),
    });
}

// Avatar API
export function getAvatarUrl(filename: string): string {
    return `${API_BASE}/auth/avatar/${filename}`;
}

export async function uploadAvatar(file: File): Promise<{ message: string; avatar_url: string }> {
    const formData = new FormData();
    formData.append('avatar', file);

    const token = getToken();
    const response = await fetch(`${API_BASE}/auth/avatar`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
    });

    let data: any;
    try {
        const text = await response.text();
        data = JSON.parse(text);
    } catch {
        throw new Error('Failed to upload avatar');
    }
    if (!response.ok) throw new Error(data.error || 'Avatar upload failed');
    return data;
}

export async function removeAvatar(): Promise<{ message: string }> {
    return apiRequest<{ message: string }>('/auth/avatar', { method: 'DELETE' });
}

// ============================================
// TWO-FACTOR AUTH (2FA) API
// ============================================

export async function loginWith2FA(
    tempToken: string,
    code: string
): Promise<AuthenticatedResponse> {
    return apiRequest<AuthenticatedResponse>('/auth/login/2fa', {
        method: 'POST',
        body: JSON.stringify({ temp_token: tempToken, code }),
    });
}

export async function setup2FA(): Promise<{ secret: string, qrCodeUrl: string }> {
    return apiRequest<{ secret: string, qrCodeUrl: string }>('/auth/2fa/setup', {
        method: 'GET',
    });
}

export async function verify2FA(code: string): Promise<{ message: string, user: User }> {
    return apiRequest<{ message: string, user: User }>('/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ code }),
    });
}

export async function disable2FA(currentPassword: string): Promise<{ message: string, user: User }> {
    return apiRequest<{ message: string, user: User }>('/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ currentPassword }),
    });
}

export async function changePassword(
    currentPassword: string,
    newPassword: string
): Promise<{ message: string }> {
    return apiRequest<{ message: string }>('/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
    });
}

export async function requestPasswordReset(email: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
    });
}

export async function resetPasswordWithToken(
    email: string,
    token: string,
    newPassword: string
): Promise<{ message: string }> {
    return apiRequest<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, token, newPassword }),
    });
}

// ============================================
// ADMIN API
// ============================================

export async function getUsers(): Promise<{ users: User[] }> {
    return apiRequest<{ users: User[] }>('/admin/users');
}

export async function createUser(
    username: string,
    password: string,
    email?: string,
    isAdmin: boolean = false
): Promise<{ message: string; user: User }> {
    return apiRequest<{ message: string; user: User }>('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, email, isAdmin }),
    });
}

export async function deleteUser(userId: number): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/admin/users/${userId}`, {
        method: 'DELETE',
    });
}

export async function adminResetPassword(
    userId: number,
    newPassword: string
): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/admin/users/${userId}/password`, {
        method: 'PUT',
        body: JSON.stringify({ newPassword }),
    });
}

export async function updateUserStorage(
    userId: number,
    storageId: string
): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/admin/users/${userId}/storage`, {
        method: 'PUT',
        body: JSON.stringify({ default_storage_id: storageId }),
    });
}

export async function setUserQuota(
    userId: number,
    quotaMb: number | null
): Promise<{ message: string; storage_quota: number | null }> {
    return apiRequest<{ message: string; storage_quota: number | null }>(`/admin/users/${userId}/quota`, {
        method: 'PUT',
        body: JSON.stringify({ quota_mb: quotaMb }),
    });
}

export async function disableUser(
    userId: number,
    disabled: boolean
): Promise<{ message: string; is_disabled: number }> {
    return apiRequest<{ message: string; is_disabled: number }>(`/admin/users/${userId}/disable`, {
        method: 'PUT',
        body: JSON.stringify({ disabled }),
    });
}

export async function toggleUserRole(
    userId: number,
    isAdmin: boolean
): Promise<{ message: string; is_admin: number }> {
    return apiRequest<{ message: string; is_admin: number }>(`/admin/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ is_admin: isAdmin }),
    });
}

export async function unlockUser(
    userId: number
): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/admin/users/${userId}/unlock`, {
        method: 'PUT',
    });
}

// ============================================
// FILES API
// ============================================

export interface FileItem {
    id: number;
    name: string;
    type: 'folder' | 'document' | 'image' | 'video' | 'audio' | 'archive';
    size: number;
    mime_type: string | null;
    parent_id: number | null;
    starred: number;
    created_at: string;
    modified_at: string;
    trashed_at?: string;
    is_accessible?: boolean | number;  // from JOIN with storage_sources
    storage_source_id?: string;
}

export interface Breadcrumb {
    id: number;
    name: string;
}

export interface FilesResponse {
    files: FileItem[];
    breadcrumbs: Breadcrumb[];
}

export interface StorageStats {
    totalBytes: number;
    usedBytes: number;
}

// List files in a folder
export async function getFiles(parentId: number | null = null): Promise<FilesResponse> {
    const query = parentId ? `?parent_id=${parentId}` : '';
    return apiRequest<FilesResponse>(`/files${query}`);
}

// Get system storage stats
export async function getStorageStats(): Promise<StorageStats> {
    return apiRequest<StorageStats>('/files/storage-stats');
}

// List starred files
export async function getStarredFiles(): Promise<FilesResponse> {
    return apiRequest<FilesResponse>('/files?starred=true');
}

// List recent files
export async function getRecentFiles(): Promise<{ files: FileItem[] }> {
    return apiRequest<{ files: FileItem[] }>('/files/recent');
}

// List trash
export async function getTrash(): Promise<{ files: FileItem[] }> {
    return apiRequest<{ files: FileItem[] }>('/files/trash');
}

// Search across all files
export interface SearchResult extends FileItem {
    location: string; // breadcrumb path like "Documents / Work"
}

export async function searchFiles(query: string): Promise<{ files: SearchResult[]; query: string }> {
    return apiRequest<{ files: SearchResult[]; query: string }>(`/files/search?q=${encodeURIComponent(query)}`);
}

// Create folder
export async function createFolder(name: string, parentId: number | null = null): Promise<{ message: string; folder: FileItem }> {
    return apiRequest<{ message: string; folder: FileItem }>('/files/folder', {
        method: 'POST',
        body: JSON.stringify({ name, parent_id: parentId }),
    });
}

// Upload files
export async function uploadFiles(files: File[], parentId: number | null = null): Promise<{ message: string; files: FileItem[] }> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    if (parentId) formData.append('parent_id', String(parentId));

    const token = getToken();
    const response = await fetch(`${API_BASE}/files/upload`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
        body: formData,
    });

    // Safe JSON parse for upload responses too
    let data: any;
    try {
        const text = await response.text();
        data = JSON.parse(text);
    } catch {
        throw new Error(
            `Upload failed: The server returned an unexpected response. ` +
            'Your assigned storage drive may be disconnected.'
        );
    }
    if (!response.ok) throw new Error(data.error || 'Upload failed');
    return data;
}

// Download file
export function getDownloadUrl(fileId: number): string {
    return `${API_BASE}/files/${fileId}/download`;
}

// Preview image
export function getPreviewUrl(fileId: number): string {
    const token = getToken();
    return `${API_BASE}/files/${fileId}/preview?token=${token}`;
}

// Rich media thumbnail (image/video)
export function getThumbnailUrl(fileId: number, size: number = 256): string {
    const token = getToken();
    return `${API_BASE}/files/${fileId}/thumbnail?token=${token}&size=${size}`;
}

export async function downloadFile(fileId: number, fileName: string): Promise<void> {
    const token = getToken();
    const response = await fetch(`${API_BASE}/files/${fileId}/download`, {
        headers: {
            'Authorization': `Bearer ${token}`,
        },
    });

    if (!response.ok) throw new Error('Download failed');

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
}

// Rename file/folder
export async function renameFile(fileId: number, name: string): Promise<{ message: string; file: FileItem }> {
    return apiRequest<{ message: string; file: FileItem }>(`/files/${fileId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
    });
}

// Toggle star
export async function toggleStar(fileId: number): Promise<{ message: string; starred: boolean }> {
    return apiRequest<{ message: string; starred: boolean }>(`/files/${fileId}/star`, {
        method: 'PUT',
    });
}

// Move file/folder
export async function moveFile(fileId: number, parentId: number | null): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/files/${fileId}/move`, {
        method: 'PUT',
        body: JSON.stringify({ parent_id: parentId }),
    });
}

// Copy file/folder
export async function copyFile(fileId: number, parentId: number | null): Promise<{ message: string; file: FileItem }> {
    return apiRequest<{ message: string; file: FileItem }>(`/files/${fileId}/copy`, {
        method: 'POST',
        body: JSON.stringify({ parent_id: parentId }),
    });
}

// Delete (move to trash)
export async function deleteFile(fileId: number): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/files/${fileId}`, {
        method: 'DELETE',
    });
}

// Restore from trash
export async function restoreFile(fileId: number): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/files/${fileId}/restore`, {
        method: 'PUT',
    });
}

// Permanent delete
export async function permanentDeleteFile(fileId: number): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/files/${fileId}/permanent`, {
        method: 'DELETE',
    });
}

// ============= SHARES =============

export interface ShareUser {
    id: number;
    username: string;
}

export interface ShareItem {
    id: number;
    file_id: number;
    shared_by: number;
    shared_with: number;
    permission: string;
    share_link: string;
    created_at: string;
    file_name: string;
    file_type: string;
    file_size: number;
    mime_type: string;
    // For my-shares
    shared_with_name?: string;
    // For shared-with-me
    shared_by_name?: string;
}

export interface ShareAccessItem {
    id: number;
    file_id: number;
    shared_with: number;
    permission: string;
    created_at: string;
    share_link: string;
    shared_with_name?: string;
}

// List users to share with
export async function getShareUsers(): Promise<{ users: ShareUser[] }> {
    return apiRequest<{ users: ShareUser[] }>('/shares/users');
}

// Share a file with a user
export async function createShareLink(fileId: number, sharedWithId: number, permission: string = 'view'): Promise<{ message: string; share: ShareItem }> {
    return apiRequest<{ message: string; share: ShareItem }>('/shares', {
        method: 'POST',
        body: JSON.stringify({ fileId, sharedWithId, permission }),
    });
}

// List files I've shared
export async function getMyShares(): Promise<{ shares: ShareItem[] }> {
    return apiRequest<{ shares: ShareItem[] }>('/shares/my-shares');
}

// List users who currently have access to a specific file
export async function getShareAccess(fileId: number): Promise<{
    file: { id: number; name: string; type: string };
    access: ShareAccessItem[];
}> {
    return apiRequest(`/shares/file/${fileId}/access`);
}

// List files shared with me
export async function getSharedWithMe(): Promise<{ shares: ShareItem[] }> {
    return apiRequest<{ shares: ShareItem[] }>('/shares/shared-with-me');
}

// Revoke a share
export async function revokeShare(shareId: number): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/shares/${shareId}`, {
        method: 'DELETE',
    });
}

// Revoke a specific user's access from a shared file
export async function revokeShareAccess(fileId: number, userId: number): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/shares/file/${fileId}/access/${userId}`, {
        method: 'DELETE',
    });
}

// Browse inside a shared folder
export interface SharedFolderResponse {
    files: FileItem[];
    breadcrumbs: Breadcrumb[];
    shareId: number;
    rootFolderId: number;
}

export async function getSharedFolderFiles(shareId: number, parentId?: number): Promise<SharedFolderResponse> {
    const query = parentId ? `?parent_id=${parentId}` : '';
    return apiRequest<SharedFolderResponse>(`/shares/shared-folder/${shareId}/files${query}`);
}

// Download a file from a shared folder
export async function downloadSharedFile(shareId: number, fileId: number, fileName: string): Promise<void> {
    const token = getToken();
    const response = await fetch(`${API_BASE}/shares/shared-folder/${shareId}/download/${fileId}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
        },
    });

    if (!response.ok) throw new Error('Download failed');

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
}

// Get preview URL for a file inside a shared folder
export function getSharedFilePreviewUrl(shareId: number, fileId: number): string {
    const token = getToken();
    return `${API_BASE}/shares/shared-folder/${shareId}/preview/${fileId}?token=${token}`;
}

// ============= DASHBOARD =============

export interface DashboardStats {
    totalFiles: number;
    totalStorage: number;
    totalFolders: number;
    byType: Record<string, { count: number; size: number }>;
    recentFiles: {
        id: number;
        name: string;
        type: string;
        size: number;
        mime_type: string;
        created_at: string;
    }[];
    sharedByMe: number;
    sharedWithMe: number;
}

export interface SystemHealth {
    cpu: { usage: number; model: string; cores: number; temperature: number | null };
    ram: { total: number; used: number; free: number; percentage: number };
    disk: { total: number; used: number; free: number; percentage: number };
    uptime: number;
    platform: string;
    hostname: string;
    ip: string;
}

export async function getDashboardStats(): Promise<DashboardStats> {
    return apiRequest<DashboardStats>('/dashboard/stats');
}

export async function getSystemHealth(): Promise<SystemHealth> {
    return apiRequest<SystemHealth>('/dashboard/health');
}

// ============= ADMIN SETTINGS =============

export interface RateLimitSettings {
    [key: string]: {
        value: string;
        description: string;
    };
}

export async function getRateLimitSettings(): Promise<{ settings: RateLimitSettings }> {
    return apiRequest<{ settings: RateLimitSettings }>('/admin/settings');
}

export async function updateSettings(
    settings: Record<string, string>
): Promise<{ message: string; updated: string[] }> {
    return apiRequest<{ message: string; updated: string[] }>('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings }),
    });
}

export async function testSmtpSettings(
    settings: Record<string, string>
): Promise<{ message: string }> {
    return apiRequest<{ message: string }>('/admin/settings/test-smtp', {
        method: 'POST',
        body: JSON.stringify(settings),
    });
}

// ============= STORAGE SOURCES =============

export interface StorageSource {
    id: string;
    label: string;
    path: string;
    type: 'internal' | 'external';
    is_active: number;
    is_accessible: boolean;
    total_bytes: number;
    used_bytes: number;
    free_bytes: number;
    file_count: number;
    created_at: string;
}

export async function getStorageSources(): Promise<{ sources: StorageSource[] }> {
    return apiRequest<{ sources: StorageSource[] }>('/admin/storage');
}

export async function addStorageSource(
    drivePath: string,
    label: string
): Promise<{ message: string; source: StorageSource }> {
    return apiRequest<{ message: string; source: StorageSource }>('/admin/storage', {
        method: 'POST',
        body: JSON.stringify({ path: drivePath, label }),
    });
}

export async function updateStorageSource(
    id: string,
    updates: { label?: string; is_active?: number }
): Promise<{ message: string; source: StorageSource }> {
    return apiRequest<{ message: string; source: StorageSource }>(`/admin/storage/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
    });
}

export async function removeStorageSource(
    id: string
): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/admin/storage/${id}`, {
        method: 'DELETE',
    });
}

// ============= DRIVE MANAGEMENT =============

export interface DetectedDrive {
    name: string;
    path: string;
    size: number;
    freeBytes: number;
    label: string;
    isMounted: boolean;
    isRegistered: boolean;
    registeredId: string | null;
}

export interface RegisteredSource {
    id: string;
    label: string;
    path: string;
    type: string;
    is_active: number;
    status: 'online' | 'detected' | 'offline';
}

export interface DrivesScanResponse {
    drives: DetectedDrive[];
    registeredSources: RegisteredSource[];
    platform: string;
    message?: string;
}

export async function scanDrives(): Promise<DrivesScanResponse> {
    return apiRequest<DrivesScanResponse>('/admin/drives');
}

// ============= DRIVE KEY-WRAPPING (Encryption) =============

export interface KeyStatus {
    source_id: string;
    label: string;
    has_key_blob: boolean;
    unlocked: boolean;
    path_accessible: boolean;
}

export async function getDriveKeyStatus(
    sourceId: string
): Promise<KeyStatus> {
    return apiRequest<KeyStatus>(`/admin/storage/${sourceId}/key-status`);
}

export async function setupDriveKey(
    sourceId: string,
    passphrase: string
): Promise<{ message: string; source_id: string; key_blob_path: string; migration_note: string }> {
    return apiRequest(`/admin/storage/${sourceId}/setup-key`, {
        method: 'POST',
        body: JSON.stringify({ passphrase }),
    });
}

export async function unlockDrive(
    sourceId: string,
    passphrase: string
): Promise<{ message: string; source_id: string; locked: boolean }> {
    return apiRequest(`/admin/storage/${sourceId}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ passphrase }),
    });
}

export async function lockDrive(
    sourceId: string
): Promise<{ message: string; source_id: string; locked: boolean }> {
    return apiRequest(`/admin/storage/${sourceId}/lock`, {
        method: 'POST',
    });
}

// ============= DRIVE STATUS SSE =============

export interface DriveStatusEvent {
    source_id: string;
    label: string;
    status: 'online' | 'offline';
    timestamp: number;
}

export interface SSEConnectedEvent {
    message: string;
    drives: DriveStatusEvent[];
}

/**
 * Create an EventSource connection for real-time drive status updates.
 * Uses SSE (Server-Sent Events) — no polling needed.
 *
 * @param onStatusChange - Called when a drive's status changes
 * @param onConnected - Called with initial drive states on connection
 * @returns cleanup function to close the connection
 */
export function subscribeToDriveEvents(
    onStatusChange: (data: DriveStatusEvent) => void,
    onConnected?: (data: SSEConnectedEvent) => void
): () => void {
    const token = getToken();
    if (!token) return () => {};

    const es = new EventSource(`${API_BASE}/events?token=${encodeURIComponent(token)}`);

    es.addEventListener('connected', (e) => {
        try {
            const data = JSON.parse((e as MessageEvent).data);
            onConnected?.(data);
        } catch { /* ignore parse errors */ }
    });

    es.addEventListener('drive_status_change', (e) => {
        try {
            const data = JSON.parse((e as MessageEvent).data);
            onStatusChange(data);
        } catch { /* ignore parse errors */ }
    });

    es.onerror = () => {
        // EventSource auto-reconnects on error — no manual handling needed.
        // The browser will retry with exponential backoff.
    };

    // Return cleanup function
    return () => es.close();
}
