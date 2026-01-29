import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { User } from "@/lib/api";
import {
    login as apiLogin,
    getCurrentUser,
    setToken,
    removeToken,
    getToken
} from "@/lib/api";

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
    updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        checkAuth();
    }, []);

    async function checkAuth() {
        const token = getToken();

        if (!token) {
            setIsLoading(false);
            return;
        }

        try {
            const { user } = await getCurrentUser();
            setUser(user);
        } catch {
            removeToken();
        } finally {
            setIsLoading(false);
        }
    }

    async function login(email: string, password: string) {
        const response = await apiLogin(email, password);
        setToken(response.token);
        setUser(response.user);
    }

    function logout() {
        removeToken();
        setUser(null);
        window.location.href = '/auth/login';
    }

    function updateUser(updatedUser: User) {
        setUser(updatedUser);
    }

    return (
        <AuthContext.Provider
            value={{
                user,
                isLoading,
                isAuthenticated: !!user,
                login,
                logout,
                updateUser,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
