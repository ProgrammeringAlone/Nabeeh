import { createRoot } from "react-dom/client";
import "@fontsource/noto-sans-arabic/400.css";
import "@fontsource/noto-sans-arabic/600.css";
import "@fontsource/noto-sans-arabic/800.css";
import { App } from "./App";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<App />);
