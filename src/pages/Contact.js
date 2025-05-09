import React, { useState } from "react";

const Contact = () => {
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        message: "",
    });

    const [errors, setErrors] = useState({});
    const [submitStatus, setSubmitStatus] = useState("idle");

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: value,
        }));
        // Clear error when user starts typing
        if (errors[name]) {
            setErrors((prev) => ({
                ...prev,
                [name]: "",
            }));
        }
    };

    const validateForm = () => {
        const newErrors = {};
        if (!formData.name.trim()) {
            newErrors.name = "Hey, I'd love to know your name!";
        }
        if (!formData.email.trim()) {
            newErrors.email = "How am I supposed to reply without an email?";
        } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
            newErrors.email = "That doesn't look like a valid email address!";
        }
        if (!formData.message.trim()) {
            newErrors.message = "Don't be shy, say something!";
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validateForm()) return;

        setSubmitStatus("sending");
        // Simulate form submission
        try {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            setSubmitStatus("success");
            setFormData({ name: "", email: "", message: "" });
        } catch (error) {
            setSubmitStatus("error");
        }
    };

    return (
        <div className="contact-page">
            <h1 className="page-title ibm-plex-sans-regular">Let's Chat!</h1>
            <p className="contact-intro">
                Want to talk about coding, share project ideas, or just say hi? Drop me a message below! I promise to reply (maybe). 😄
            </p>

            <div className="contact-container">
                <div className="contact-info">
                    <h2>Find Me Here</h2>
                    <div className="contact-methods">
                        <div className="contact-method">
                            <div className="contact-icon">📧</div>
                            <div className="contact-details">
                                <h3>Email</h3>
                                <a href="mailto:jr@jrbussard.com">jr@jrbussard.com</a>
                            </div>
                        </div>
                        <div className="contact-method">
                            <div className="contact-icon">💻</div>
                            <div className="contact-details">
                                <h3>GitHub</h3>
                                <a href="https://github.com/pirut">github.com/pirut</a>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="contact-form-container">
                    <h2>Send Me a Message</h2>
                    <form className="contact-form" onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label htmlFor="name">Your Name</label>
                            <input
                                type="text"
                                id="name"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                className={errors.name ? "error" : ""}
                                placeholder="What should I call you?"
                            />
                            {errors.name && <div className="error-message">{errors.name}</div>}
                        </div>

                        <div className="form-group">
                            <label htmlFor="email">Your Email</label>
                            <input
                                type="email"
                                id="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                className={errors.email ? "error" : ""}
                                placeholder="Where should I reply?"
                            />
                            {errors.email && <div className="error-message">{errors.email}</div>}
                        </div>

                        <div className="form-group">
                            <label htmlFor="message">Message</label>
                            <textarea
                                id="message"
                                name="message"
                                value={formData.message}
                                onChange={handleChange}
                                className={errors.message ? "error" : ""}
                                placeholder="What's on your mind?"
                                rows="5"
                            ></textarea>
                            {errors.message && <div className="error-message">{errors.message}</div>}
                        </div>

                        <button type="submit" className="submit-button" disabled={submitStatus === "sending"}>
                            {submitStatus === "sending" ? "Sending..." : "Send Message"}
                        </button>
                        {submitStatus === "success" && <div className="success-message">Message sent! I'll get back to you soon! 🎉</div>}
                        {submitStatus === "error" && <div className="error-message">Oops! Something went wrong. Try again? 🤔</div>}
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Contact;
