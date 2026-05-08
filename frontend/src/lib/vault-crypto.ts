const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const PBKDF2_ITERATIONS = 600_000
export const CHUNK_SIZE_BYTES = 5 * 1024 * 1024
export const LARGE_FILE_THRESHOLD_BYTES = 10 * 1024 * 1024

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = ""
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }
    return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function randomBytes(length: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length))
}

async function deriveKek(pin: string, salt: Uint8Array): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(pin),
        "PBKDF2",
        false,
        ["deriveKey"],
    )

    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: toArrayBuffer(salt),
            iterations: PBKDF2_ITERATIONS,
            hash: "SHA-256",
        },
        keyMaterial,
        {
            name: "AES-GCM",
            length: 256,
        },
        false,
        ["encrypt", "decrypt"],
    )
}

export async function generateDek(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        ["encrypt", "decrypt"],
    )
}

export async function createVaultEnvelope(pin: string): Promise<{
    dek: CryptoKey
    salt: string
    encryptedDek: string
    dekIv: string
}> {
    const dek = await generateDek()
    const salt = randomBytes(16)
    const dekIv = randomBytes(12)
    const kek = await deriveKek(pin, salt)
    const rawDek = new Uint8Array(await crypto.subtle.exportKey("raw", dek))
    const encryptedDek = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: toArrayBuffer(dekIv) },
        kek,
        rawDek,
    )

    return {
        dek,
        salt: bytesToBase64(salt),
        encryptedDek: bytesToBase64(new Uint8Array(encryptedDek)),
        dekIv: bytesToBase64(dekIv),
    }
}

export async function unwrapVaultDek(pin: string, saltBase64: string, encryptedDekBase64: string, dekIvBase64: string): Promise<CryptoKey> {
    const salt = base64ToBytes(saltBase64)
    const encryptedDek = base64ToBytes(encryptedDekBase64)
    const dekIv = base64ToBytes(dekIvBase64)
    const kek = await deriveKek(pin, salt)
    const rawDek = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(dekIv) },
        kek,
        toArrayBuffer(encryptedDek),
    )

    return crypto.subtle.importKey(
        "raw",
        rawDek,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"],
    )
}

export async function rewrapVaultDek(dek: CryptoKey, pin: string): Promise<{
    salt: string
    encryptedDek: string
    dekIv: string
}> {
    const salt = randomBytes(16)
    const dekIv = randomBytes(12)
    const kek = await deriveKek(pin, salt)
    const rawDek = new Uint8Array(await crypto.subtle.exportKey("raw", dek))
    const encryptedDek = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: toArrayBuffer(dekIv) },
        kek,
        rawDek,
    )

    return {
        salt: bytesToBase64(salt),
        encryptedDek: bytesToBase64(new Uint8Array(encryptedDek)),
        dekIv: bytesToBase64(dekIv),
    }
}

export async function encryptMetadata(dek: CryptoKey, value: string): Promise<string> {
    const iv = randomBytes(12)
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv) },
        dek,
        textEncoder.encode(value),
    )

    return JSON.stringify({
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    })
}

export async function decryptMetadata(dek: CryptoKey, payload: string): Promise<string> {
    const parsed = JSON.parse(payload) as { iv: string; ciphertext: string }
    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(parsed.iv)) },
        dek,
        toArrayBuffer(base64ToBytes(parsed.ciphertext)),
    )

    return textDecoder.decode(plaintext)
}

export function createFileIv(): string {
    return bytesToBase64(randomBytes(12))
}

export function createStorageId(): string {
    return crypto.randomUUID()
}

export function deriveChunkIv(baseIvBase64: string, chunkIndex: number): Uint8Array {
    const base = base64ToBytes(baseIvBase64)
    if (base.length !== 12) {
        throw new Error("Invalid base IV")
    }

    const view = new DataView(base.buffer.slice(0))
    view.setUint32(8, chunkIndex, false)
    return new Uint8Array(view.buffer)
}

export async function encryptChunk(dek: CryptoKey, bytes: ArrayBuffer, baseIvBase64: string, chunkIndex: number): Promise<Uint8Array> {
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: toArrayBuffer(deriveChunkIv(baseIvBase64, chunkIndex)) },
        dek,
        bytes,
    )
    return new Uint8Array(ciphertext)
}

export async function decryptChunk(dek: CryptoKey, bytes: ArrayBuffer, baseIvBase64: string, chunkIndex: number): Promise<Uint8Array> {
    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(deriveChunkIv(baseIvBase64, chunkIndex)) },
        dek,
        bytes,
    )
    return new Uint8Array(plaintext)
}
