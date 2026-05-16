/**
 * API UTILITY
 * ===========
 * Central place for all API calls to the backend
 */

// Use relative path - Vite proxy forwards /api to the backend
const API_BASE = '/api';

function apiUrlWithToken(endpoint: string): string {
    const token = getToken();
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    const query = params.toString();
    return query ? `${API_BASE}${endpoint}?${query}` : `${API_BASE}${endpoint}`;
}

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

// ============================================
// FILES API
// ============================================

export interface FileItem {
    id: number;
    name: string;
    type: 'folder' | 'document' | 'image' | 'video' | 'audio' | 'archive' | 'other';
    size: number;
    mime_type: string | null;
    parent_id: number | null;
    starred: number;
    created_at: string;
    modified_at: string;
    accessed_at?: string | null;
    recent_at?: string;
    recent_action?: 'uploaded' | 'modified' | 'viewed';
    trashed_at?: string;
    is_accessible?: boolean | number;  // from JOIN with storage_sources
    storage_source_id?: string;
    storage_source_label?: string | null;
    storage_source_type?: string | null;
    encrypted_metadata?: string | null;
    storage_id?: string | null;
    e2ee_iv?: string | null;
    is_chunked?: number | boolean;
    chunk_count?: number;
    vault_root_id?: number | null;
    is_secure_vault?: number | boolean;
    version_number?: number;
    shared_count?: number;
    public_share_count?: number;
    is_share_shortcut?: number | boolean;
    shortcut_id?: number;
    share_id?: number;
    target_file_id?: number;
    share_permission?: SharePermission;
    share_allow_download?: number;
    share_expires_at?: string | null;
    shared_by_name?: string;
    location?: string;
}

export interface FileVersion {
    id: number;
    file_id: number;
    version_number: number;
    type: FileItem['type'];
    size: number;
    mime_type: string | null;
    sha256_hash: string | null;
    encrypted: number;
    integrity_failed: number;
    archived_at: string;
}

export interface FileVersionsResponse {
    fileId: number;
    currentVersion: number;
    versionStorageBytes: number;
    versions: FileVersion[];
}

export interface Breadcrumb {
    id: number;
    name: string;
    encrypted_metadata?: string | null;
    is_secure_vault?: number | boolean;
    vault_root_id?: number | null;
}

export interface FilesResponse {
    files: FileItem[];
    breadcrumbs: Breadcrumb[];
    currentFolder?: Breadcrumb | null;
    currentVault?: Breadcrumb | null;
}

export interface StorageStats {
    totalBytes: number;
    usedBytes: number;
    versionBytes?: number;
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

export interface TrashResponse {
    files: FileItem[];
    retentionDays: number;
    purged?: EmptyTrashResponse;
}

// List trash
export async function getTrash(): Promise<TrashResponse> {
    return apiRequest<TrashResponse>('/files/trash');
}

// Search across all files
export interface SearchResult extends FileItem {
    location: string; // breadcrumb path like "Documents / Work"
}

export interface SearchFilters {
    type?: string;
    starred?: boolean;
    shared?: boolean;
    minSize?: number | null;
    maxSize?: number | null;
    modifiedAfter?: string;
    modifiedBefore?: string;
    sort?: 'relevance' | 'name' | 'modified' | 'size' | 'type';
    direction?: 'asc' | 'desc';
}

export async function searchFiles(query: string, filters: SearchFilters = {}): Promise<{ files: SearchResult[]; query: string }> {
    const params = new URLSearchParams({ q: query });
    if (filters.type && filters.type !== 'all') params.set('type', filters.type);
    if (filters.starred) params.set('starred', 'true');
    if (filters.shared) params.set('shared', 'true');
    if (filters.minSize !== undefined && filters.minSize !== null) params.set('min_size', String(filters.minSize));
    if (filters.maxSize !== undefined && filters.maxSize !== null) params.set('max_size', String(filters.maxSize));
    if (filters.modifiedAfter) params.set('modified_after', filters.modifiedAfter);
    if (filters.modifiedBefore) params.set('modified_before', filters.modifiedBefore);
    if (filters.sort && filters.sort !== 'relevance') params.set('sort', filters.sort);
    if (filters.direction) params.set('direction', filters.direction);
    return apiRequest<{ files: SearchResult[]; query: string }>(`/files/search?${params.toString()}`);
}

// Create folder
export async function createFolder(name: string, parentId: number | null = null): Promise<{ message: string; folder: FileItem }> {
    return apiRequest<{ message: string; folder: FileItem }>('/files/folder', {
        method: 'POST',
        body: JSON.stringify({ name, parent_id: parentId }),
    });
}

// Upload files
export async function uploadFiles(
    files: File[],
    parentId: number | null = null,
    signal?: AbortSignal
): Promise<{ message: string; files: FileItem[] }> {
    const formData = new FormData();
    files.forEach(file => {
        formData.append('files', file);
        const relativePath =
            (file as File & { cloudpiRelativePath?: string; webkitRelativePath?: string }).cloudpiRelativePath ||
            (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
            file.name;
        formData.append('relative_paths', relativePath);
    });
    if (parentId) formData.append('parent_id', String(parentId));

    const token = getToken();
    const response = await fetch(`${API_BASE}/files/upload`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
        body: formData,
        signal,
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

export async function initFileUpload(payload: {
    parent_id: number | null;
    name: string;
    size: number;
    mime_type: string;
    relative_path?: string;
    chunk_count: number;
}): Promise<{ upload: { id: string; chunk_count: number; chunk_size: number } }> {
    return apiRequest<{ upload: { id: string; chunk_count: number; chunk_size: number } }>('/files/uploads/init', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function uploadFileChunk(uploadId: string, index: number, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    const token = getToken();
    const response = await fetch(`${API_BASE}/files/uploads/${uploadId}/chunks/${index}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(bytes).buffer,
        signal,
    });

    if (!response.ok) {
        let message = 'Chunk upload failed';
        try {
            const data = await response.json();
            message = data.error || message;
        } catch {
            // keep default message
        }
        throw new Error(message);
    }
}

export async function completeFileUpload(uploadId: string): Promise<{ message: string; file: FileItem }> {
    return apiRequest<{ message: string; file: FileItem }>(`/files/uploads/${uploadId}/complete`, {
        method: 'POST',
    });
}

export async function abortFileUpload(uploadId: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/files/uploads/${uploadId}`, {
        method: 'DELETE',
    });
}

// Download file
export function getDownloadUrl(fileId: number): string {
    return `${API_BASE}/files/${fileId}/download`;
}

// Preview image
export function getPreviewUrl(fileId: number): string {
    return apiUrlWithToken(`/files/${fileId}/preview`);
}

// Rich media thumbnail (image/video)
export function getThumbnailUrl(fileId: number, size: number = 256): string {
    const url = apiUrlWithToken(`/files/${fileId}/thumbnail`);
    return `${url}${url.includes('?') ? '&' : '?'}size=${encodeURIComponent(String(size))}`;
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

export async function downloadFilesZip(fileIds: number[], fileName = 'cloudpi-selection.zip'): Promise<void> {
    const token = getToken();
    const response = await fetch(`${API_BASE}/files/bulk-download`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileIds }),
    });

    if (!response.ok) {
        let message = 'Download failed';
        try {
            const data = await response.json();
            message = data.error || message;
        } catch {
            // keep default message
        }
        throw new Error(message);
    }

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

// File versions
export async function getFileVersions(fileId: number): Promise<FileVersionsResponse> {
    return apiRequest<FileVersionsResponse>(`/files/${fileId}/versions`);
}

export async function restoreFileVersion(
    fileId: number,
    versionId: number
): Promise<{ message: string; file: FileItem }> {
    return apiRequest<{ message: string; file: FileItem }>(`/files/${fileId}/versions/${versionId}/restore`, {
        method: 'POST',
    });
}

export async function deleteFileVersion(
    fileId: number,
    versionId: number
): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/files/${fileId}/versions/${versionId}`, {
        method: 'DELETE',
    });
}

export interface EmptyTrashResponse {
    message: string;
    deletedItems: number;
    deletedFiles: number;
    freedBytes: number;
}

export async function emptyTrash(): Promise<EmptyTrashResponse> {
    return apiRequest<EmptyTrashResponse>('/files/trash/empty', {
        method: 'DELETE',
    });
}

// ============= SECURE VAULTS =============

export interface VaultEnvelopePayload {
    salt: string;
    encrypted_dek: string;
    dek_iv: string;
}

export interface VaultMetadata extends VaultEnvelopePayload {
    id: number;
    name: string;
    parent_id: number | null;
    created_at: string;
}

export async function createSecureVault(
    name: string,
    parentId: number | null,
    envelope: VaultEnvelopePayload,
): Promise<{ message: string; folder: FileItem }> {
    return apiRequest<{ message: string; folder: FileItem }>('/vaults', {
        method: 'POST',
        body: JSON.stringify({
            name,
            parent_id: parentId,
            ...envelope,
        }),
    });
}

export async function getVaultMetadata(vaultId: number): Promise<{ vault: VaultMetadata }> {
    return apiRequest<{ vault: VaultMetadata }>(`/vaults/${vaultId}`);
}

export async function changeVaultPin(
    vaultId: number,
    envelope: VaultEnvelopePayload,
): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/vaults/${vaultId}/pin`, {
        method: 'PUT',
        body: JSON.stringify(envelope),
    });
}

export async function createVaultFolder(
    vaultId: number,
    parentId: number,
    encryptedMetadata: string,
): Promise<{ message: string; folder: FileItem }> {
    return apiRequest<{ message: string; folder: FileItem }>(`/vaults/${vaultId}/folders`, {
        method: 'POST',
        body: JSON.stringify({
            parent_id: parentId,
            encrypted_metadata: encryptedMetadata,
        }),
    });
}

export async function renameVaultItem(
    itemId: number,
    encryptedMetadata: string,
): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/vaults/items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify({
            encrypted_metadata: encryptedMetadata,
        }),
    });
}

export async function initVaultUpload(
    vaultId: number,
    payload: {
        parent_id: number;
        storage_id: string;
        encrypted_metadata: string;
        e2ee_iv: string;
        chunk_count: number;
        size: number;
        mime_type: string;
    },
): Promise<{ upload: { id: string; chunk_count: number } }> {
    return apiRequest<{ upload: { id: string; chunk_count: number } }>(`/vaults/${vaultId}/uploads/init`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function uploadVaultChunk(uploadId: string, index: number, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    const token = getToken();
    const body = new Uint8Array(bytes).buffer;
    const response = await fetch(`${API_BASE}/vaults/uploads/${uploadId}/chunks/${index}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
        },
        body,
        signal,
    });

    if (!response.ok) {
        let message = 'Secure chunk upload failed';
        try {
            const data = JSON.parse(await response.text());
            message = data.error || message;
        } catch {
            // Ignore parse failures
        }
        throw new Error(message);
    }
}

export async function completeVaultUpload(uploadId: string): Promise<{ message: string; file: FileItem }> {
    return apiRequest<{ message: string; file: FileItem }>(`/vaults/uploads/${uploadId}/complete`, {
        method: 'POST',
    });
}

export async function abortVaultUpload(uploadId: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/vaults/uploads/${uploadId}`, {
        method: 'DELETE',
    });
}

export async function fetchVaultChunk(fileId: number, index: number): Promise<ArrayBuffer> {
    const token = getToken();
    const response = await fetch(`${API_BASE}/vaults/files/${fileId}/chunks/${index}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
        },
    });

    if (!response.ok) {
        let message = 'Failed to fetch encrypted file chunk';
        try {
            const data = JSON.parse(await response.text());
            message = data.error || message;
        } catch {
            // Ignore parse failures
        }
        throw new Error(message);
    }

    return response.arrayBuffer();
}

// ============= SHARES =============

export interface ShareUser {
    id: number;
    username: string;
    email?: string | null;
}

export type SharePermission = 'view' | 'edit' | 'upload';

export interface ShareOptions {
    expiresAt?: string | null;
    allowDownload?: boolean;
    password?: string;
}

export interface ShareItem {
    id: number;
    file_id: number;
    shared_by: number;
    shared_with: number | null;
    shared_with_email?: string | null;
    permission: SharePermission;
    share_link: string;
    share_type?: 'user' | 'link';
    expires_at?: string | null;
    allow_download?: number;
    password_protected?: number;
    access_count?: number;
    last_accessed_at?: string | null;
    is_expired?: number;
    created_at: string;
    file_name: string;
    file_type: string;
    file_size: number;
    mime_type: string;
    // For my-shares
    shared_with_name?: string;
    // For shared-with-me
    shared_by_name?: string;
    shortcut_id?: number | null;
}

export interface ShareAccessItem {
    id: number;
    file_id: number;
    shared_with: number | null;
    permission: SharePermission;
    created_at: string;
    share_link: string;
    share_type?: 'user' | 'link';
    expires_at?: string | null;
    allow_download?: number;
    password_protected?: number;
    is_expired?: number;
    shared_with_name?: string;
}

export interface ShareActivityItem {
    id: number;
    ip_address: string | null;
    user_agent: string | null;
    action: string;
    created_at: string;
    accessed_by: number | null;
    accessed_by_name?: string | null;
}

// List users to share with
export async function getShareUsers(): Promise<{ users: ShareUser[] }> {
    return apiRequest<{ users: ShareUser[] }>('/shares/users');
}

// Share a file with a user
export async function createShareLink(
    fileId: number,
    sharedWithId: number,
    options: ShareOptions = {}
): Promise<{ message: string; share: ShareItem }> {
    return apiRequest<{ message: string; share: ShareItem }>('/shares', {
        method: 'POST',
        body: JSON.stringify({
            fileId,
            sharedWithId,
            expiresAt: options.expiresAt || null,
            allowDownload: options.allowDownload ?? true,
        }),
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

export async function updateShare(
    shareId: number,
    updates: {
        expiresAt?: string | null;
        allowDownload?: boolean;
        password?: string;
    }
): Promise<{ message: string; share: ShareItem }> {
    return apiRequest<{ message: string; share: ShareItem }>(`/shares/${shareId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
    });
}

export async function bulkShareAction(
    shareIds: number[],
    action: 'revoke' | 'update',
    updates: {
        expiresAt?: string | null;
        allowDownload?: boolean;
    } = {}
): Promise<{ message: string; count: number }> {
    return apiRequest<{ message: string; count: number }>('/shares/bulk', {
        method: 'POST',
        body: JSON.stringify({ shareIds, action, ...updates }),
    });
}

export async function leaveShare(shareId: number): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/shares/shared-with-me/${shareId}`, {
        method: 'DELETE',
    });
}

export async function addShareShortcut(shareId: number): Promise<{
    message: string;
    shortcut: { id: number; user_id: number; share_id: number; created_at: string };
}> {
    return apiRequest(`/shares/${shareId}/shortcut`, {
        method: 'POST',
    });
}

export async function removeShareShortcut(shareId: number): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/shares/${shareId}/shortcut`, {
        method: 'DELETE',
    });
}

export async function getShareActivity(shareId: number): Promise<{ logs: ShareActivityItem[] }> {
    return apiRequest<{ logs: ShareActivityItem[] }>(`/shares/${shareId}/activity`);
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
    return apiUrlWithToken(`/shares/shared-folder/${shareId}/preview/${fileId}`);
}

// ============= DASHBOARD =============

export interface DashboardStats {
    totalFiles: number;
    totalStorage: number;
    versionStorage?: number;
    totalFolders: number;
    storageQuota: number | null;
    trashFiles: number;
    trashStorage: number;
    byType: Record<string, { count: number; size: number }>;
    recentFiles: {
        id: number;
        name: string;
        type: string;
        size: number;
        mime_type: string | null;
        parent_id: number | null;
        location?: string;
        created_at: string;
        modified_at: string;
        accessed_at?: string | null;
        recent_at?: string;
        recent_action?: 'uploaded' | 'modified' | 'viewed';
        is_accessible?: boolean | number;
        is_secure_vault?: boolean | number;
        vault_root_id?: number | null;
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

export interface DashboardActivityItem {
    id: string;
    type: string;
    title: string;
    body: string;
    link: string | null;
    created_at: string;
    metadata: Record<string, unknown> | null;
}

export async function getDashboardStats(): Promise<DashboardStats> {
    return apiRequest<DashboardStats>('/dashboard/stats');
}

export async function getSystemHealth(): Promise<SystemHealth> {
    return apiRequest<SystemHealth>('/dashboard/health');
}

export async function getDashboardActivity(limit = 8): Promise<{ activity: DashboardActivityItem[] }> {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    return apiRequest<{ activity: DashboardActivityItem[] }>(`/dashboard/activity?${params.toString()}`);
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

export async function downloadIncomingShare(shareId: number, fileName: string): Promise<void> {
    const token = getToken();
    const response = await fetch(`${API_BASE}/shares/${shareId}/download`, {
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

export function getIncomingSharePreviewUrl(shareId: number): string {
    return apiUrlWithToken(`/shares/${shareId}/preview`);
}

// ============= NOTIFICATIONS =============

export interface NotificationItem {
    id: number;
    user_id: number;
    type: string;
    title: string;
    body: string;
    link: string | null;
    read_at: string | null;
    created_at: string;
    metadata: Record<string, unknown> | null;
}

export interface NotificationsResponse {
    notifications: NotificationItem[];
    total: number;
    limit: number;
    offset: number;
    unreadCount: number;
}

export interface NotificationPreferences {
    share_notifications: boolean;
    storage_warnings: boolean;
}

export async function getNotifications(options: {
    limit?: number;
    offset?: number;
    status?: 'all' | 'read' | 'unread';
} = {}): Promise<NotificationsResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.status && options.status !== 'all') params.set('status', options.status);
    const query = params.toString();
    return apiRequest<NotificationsResponse>(`/notifications${query ? `?${query}` : ''}`);
}

export async function getUnreadNotificationCount(): Promise<{ unreadCount: number }> {
    return apiRequest<{ unreadCount: number }>('/notifications/unread-count');
}

export async function getNotificationPreferences(): Promise<{ preferences: NotificationPreferences }> {
    return apiRequest<{ preferences: NotificationPreferences }>('/notifications/preferences');
}

export async function updateNotificationPreferences(
    preferences: Partial<NotificationPreferences>
): Promise<{ preferences: NotificationPreferences }> {
    return apiRequest<{ preferences: NotificationPreferences }>('/notifications/preferences', {
        method: 'PATCH',
        body: JSON.stringify(preferences),
    });
}

export async function markNotificationRead(notificationId: number): Promise<{
    notification: NotificationItem;
    unreadCount: number;
}> {
    return apiRequest<{ notification: NotificationItem; unreadCount: number }>(`/notifications/${notificationId}/read`, {
        method: 'PATCH',
    });
}

export async function markAllNotificationsRead(): Promise<{ updated: number; unreadCount: number }> {
    return apiRequest<{ updated: number; unreadCount: number }>('/notifications/read-all', {
        method: 'PATCH',
    });
}

export async function clearReadNotifications(): Promise<{ deleted: number; unreadCount: number }> {
    return apiRequest<{ deleted: number; unreadCount: number }>('/notifications/read', {
        method: 'DELETE',
    });
}

export interface EncryptionStats {
    encryption_enabled: boolean;
    encrypted_files: number;
    unencrypted_files: number;
    integrity_failed_files: number;
}

export async function getEncryptionStats(): Promise<EncryptionStats> {
    return apiRequest<EncryptionStats>('/admin/encryption-stats');
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
    source?: string | null;
}

export interface SkippedDriveCandidate {
    name: string;
    path: string;
    reason: string;
    source?: string | null;
    device?: string | null;
}

export interface RegisteredSource {
    id: string;
    label: string;
    path: string;
    type: string;
    is_active: number;
    is_accessible?: number | boolean;
    created_at?: string;
    status: 'online' | 'detected' | 'offline';
}

export interface DrivesScanResponse {
    drives: DetectedDrive[];
    skippedCandidates?: SkippedDriveCandidate[];
    registeredSources: RegisteredSource[];
    platform: string;
    message?: string;
}

export async function scanDrives(): Promise<DrivesScanResponse> {
    return apiRequest<DrivesScanResponse>('/admin/drives');
}

// ============= LUKS LAYER 1 =============

export interface LuksStatus {
    status: 'locked' | 'unlocked' | 'mounted' | 'no_device';
    device: string;
    mapperDevice: string;
    mountPoint: string;
}

export async function getLuksStatus(): Promise<LuksStatus> {
    return apiRequest<LuksStatus>('/luks/status');
}

export async function unlockLuksDrive(
    passphrase: string
): Promise<{ message: string; mountPoint: string }> {
    return apiRequest<{ message: string; mountPoint: string }>('/luks/unlock', {
        method: 'POST',
        body: JSON.stringify({ passphrase }),
    });
}

export async function lockLuksDrive(): Promise<{ message: string }> {
    return apiRequest<{ message: string }>('/luks/lock', {
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
 * Create an EventSource connection for real-time storage status updates.
 * Uses SSE (Server-Sent Events) — no polling needed.
 *
 * @param onStatusChange - Called when a storage source status changes
 * @param onConnected - Called with initial storage source states on connection
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
