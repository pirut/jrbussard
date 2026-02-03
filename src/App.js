import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { routes } from "./routes";
import SiteShell from "./components/SiteShell";
import "./App.css";

function App() {
    return (
        <BrowserRouter>
            <SiteShell>
                <Routes>
                    {routes.map((route) => (
                        <Route key={route.path} path={route.path} element={route.element} />
                    ))}
                </Routes>
            </SiteShell>
        </BrowserRouter>
    );
}

export default App;
