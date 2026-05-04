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

    const data = await response.json();

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
}

export interface AuthResponse {
    message: string;
    token?: string;
    user?: User;
    requires_2fa?: boolean;
    temp_token?: string;
}

export interface SetupResponse extends AuthResponse {
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
    email?: string
): Promise<ProfileUpdateResponse> {
    return apiRequest<ProfileUpdateResponse>('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ username, email }),
    });
}

// ============================================
// TWO-FACTOR AUTH (2FA) API
// ============================================

export async function loginWith2FA(
    tempToken: string,
    code: string
): Promise<AuthResponse> {
    return apiRequest<AuthResponse>('/auth/login/2fa', {
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

export async function disable2FA(): Promise<{ message: string, user: User }> {
    return apiRequest<{ message: string, user: User }>('/auth/2fa/disable', {
        method: 'POST',
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

    const data = await response.json();
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

