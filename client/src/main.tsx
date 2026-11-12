import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installDealerSessionInterceptors } from "./lib/dealerSession";

// Detect the first 401 from any dealer API call (fetch or axios) app-wide.
installDealerSessionInterceptors();

createRoot(document.getElementById("root")!).render(<App />);
