import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import NavBar from "./components/NavBar";
import Home from "./pages/Home";
import Projects from "./pages/Projects";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Calculator from "./pages/Calculator";
import "./App.css";
import "./styles/Pages.css";

function App() {
    return (
        <Router>
            <div className="App">
                <NavBar />
                <main>
                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/projects" element={<Projects />} />
                        <Route path="/about" element={<About />} />
                        <Route path="/contact" element={<Contact />} />
                        <Route path="/calculator" element={<Calculator />} />
                    </Routes>
                </main>
                <footer className="footer">
                    <p className="copyright">&copy JR Bussard 2024-Present</p>
                    <div className="linkWrapper">
                        <a href="" className="footerlink">
                            <img src="" alt="" />
                            test
                        </a>
                        <a href="" className="footerlink">
                            <img src="" alt="" />
                            test 2
                        </a>
                        <a href="" className="footerlink">
                            <img src="" alt="" />
                            test 3
                        </a>
                        <a href="" className="footerlink">
                            <img src="" alt="" />
                            test 4
                        </a>
                    </div>
                </footer>
            </div>
        </Router>
    );
}

export default App;
