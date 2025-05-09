import React, { useState } from "react";

const Contact = () => {
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        message: "",
    });

    const [errors, setErrors] = useState({});
    const [submitStatus, setSubmitStatus] = useState("");

    const validateForm = () => {
        const newErrors = {};
        if (!formData.name.trim()) {
            newErrors.name = "Name is required";
        }
        if (!formData.email.trim()) {
            newErrors.email = "Email is required";
        } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
            newErrors.email = "Email is invalid";
        }
        if (!formData.message.trim()) {
            newErrors.message = "Message is required";
        }
        return newErrors;
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prevState) => ({
            ...prevState,
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

    const handleSubmit = async (e) => {
        e.preventDefault();
        const newErrors = validateForm();

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        setSubmitStatus("sending");
        try {
            // Add your form submission logic here
            console.log("Form submitted:", formData);
            // Simulate API call
            await new Promise((resolve) => setTimeout(resolve, 1000));
            setSubmitStatus("success");
            setFormData({ name: "", email: "", message: "" });
        } catch (error) {
            setSubmitStatus("error");
        }
    };

    return (
        <div className="contact-page">
            <h1 className="page-title ibm-plex-sans-regular">Contact Me</h1>
            <p className="contact-intro">
                I'd love to hear from you! Feel free to reach out using the form below or connect with me via email or social media.
            </p>

            <div className="contact-container">
                <div className="contact-info">
                    <h2>Get in Touch</h2>
                    <div className="contact-methods">
                        <div className="contact-method">
                            <div className="contact-icon">📧</div>
                            <div className="contact-details">
                                <h3>Email</h3>
                                <p>jrbussard@example.com</p>
                            </div>
                        </div>
                        <div className="contact-method">
                            <div className="contact-icon">📱</div>
                            <div className="contact-details">
                                <h3>Phone</h3>
                                <p>(555) 123-4567</p>
                            </div>
                        </div>
                        <div className="contact-method">
                            <div className="contact-icon">🔗</div>
                            <div className="contact-details">
                                <h3>Social</h3>
                                <div className="social-links">
                                    <a href="#" className="social-link">
                                        LinkedIn
                                    </a>
                                    <a href="#" className="social-link">
                                        GitHub
                                    </a>
                                    <a href="#" className="social-link">
                                        Twitter
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="contact-form-container">
                    <h2>Send a Message</h2>
                    <form onSubmit={handleSubmit} className="contact-form">
                        <div className="form-group">
                            <label htmlFor="name">Name</label>
                            <input type="text" id="name" name="name" value={formData.name} onChange={handleChange} className={errors.name ? "error" : ""} />
                            {errors.name && <span className="error-message">{errors.name}</span>}
                        </div>
                        <div className="form-group">
                            <label htmlFor="email">Email</label>
                            <input
                                type="email"
                                id="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                className={errors.email ? "error" : ""}
                            />
                            {errors.email && <span className="error-message">{errors.email}</span>}
                        </div>
                        <div className="form-group">
                            <label htmlFor="message">Message</label>
                            <textarea
                                id="message"
                                name="message"
                                value={formData.message}
                                onChange={handleChange}
                                className={errors.message ? "error" : ""}
                                rows="5"
                            ></textarea>
                            {errors.message && <span className="error-message">{errors.message}</span>}
                        </div>
                        <button type="submit" className="submit-button" disabled={submitStatus === "sending"}>
                            {submitStatus === "sending" ? "Sending..." : "Send Message"}
                        </button>
                        {submitStatus === "success" && <div className="success-message">Message sent successfully!</div>}
                        {submitStatus === "error" && <div className="error-message">Failed to send message. Please try again.</div>}
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Contact;
