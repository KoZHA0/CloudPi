import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
    theme: Theme;
    resolvedTheme: "light" | "dark";
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getSystemTheme(): "light" | "dark" {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(() => {
        const stored = localStorage.getItem("cloudpi-theme") as Theme | null;
        return stored || "dark";
    });

    const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
        const stored = localStorage.getItem("cloudpi-theme") as Theme | null;
        const t = stored || "dark";
        return t === "system" ? getSystemTheme() : t;
    });

    function setTheme(newTheme: Theme) {
        setThemeState(newTheme);
        localStorage.setItem("cloudpi-theme", newTheme);
    }

    // Apply theme class to <html> element and track system changes
    useEffect(() => {
        const root = document.documentElement;

        function applyTheme(t: Theme) {
            const resolved = t === "system" ? getSystemTheme() : t;
            setResolvedTheme(resolved);

            if (resolved === "dark") {
                root.classList.add("dark");
                root.classList.remove("light");
            } else {
                root.classList.add("light");
                root.classList.remove("dark");
            }
        }

        applyTheme(theme);

        // Listen for system theme changes when set to "system"
        if (theme === "system") {
            const mq = window.matchMedia("(prefers-color-scheme: dark)");
            const handler = () => applyTheme("system");
            mq.addEventListener("change", handler);
            return () => mq.removeEventListener("change", handler);
        }
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}
