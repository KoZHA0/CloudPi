/**
 * API UTILITY
 * ===========
 * Central place for all API calls to the backend
 */

// Dynamically use the same hostname as the frontend
// Works with localhost, Tailscale IP, or any other hostname
const API_BASE = `http://${window.location.hostname}:3001/api`;

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
    email: string;
    is_admin?: number;
}

export interface AuthResponse {
    message: string;
    token: string;
    user: User;
}

// Setup API
export async function getSetupStatus(): Promise<{ setupRequired: boolean; userCount: number }> {
    return apiRequest<{ setupRequired: boolean; userCount: number }>('/auth/setup-status');
}

export async function setupAdmin(
    username: string,
    email: string,
    password: string
): Promise<AuthResponse> {
    return apiRequest<AuthResponse>('/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ username, email, password }),
    });
}

export async function login(
    email: string,
    password: string
): Promise<AuthResponse> {
    return apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
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
    email: string
): Promise<ProfileUpdateResponse> {
    return apiRequest<ProfileUpdateResponse>('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ username, email }),
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

// ============================================
// ADMIN API
// ============================================

export async function getUsers(): Promise<{ users: User[] }> {
    return apiRequest<{ users: User[] }>('/admin/users');
}

export async function createUser(
    username: string,
    email: string,
    password: string,
    isAdmin: boolean = false
): Promise<{ message: string; user: User }> {
    return apiRequest<{ message: string; user: User }>('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, email, password, isAdmin }),
    });
}

export async function deleteUser(userId: number): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/admin/users/${userId}`, {
        method: 'DELETE',
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

// List files in a folder
export async function getFiles(parentId: number | null = null): Promise<FilesResponse> {
    const query = parentId ? `?parent_id=${parentId}` : '';
    return apiRequest<FilesResponse>(`/files${query}`);
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
