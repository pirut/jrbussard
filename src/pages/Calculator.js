import React, { useState } from "react";

const Calculator = () => {
    const [display, setDisplay] = useState("0");
    const [equation, setEquation] = useState("");
    const [lastOperation, setLastOperation] = useState("");

    const formatNumber = (num) => {
        // Convert to number to handle potential calculation results
        const numValue = parseFloat(num);

        // Check if it's a valid number
        if (isNaN(numValue)) return "Error";

        // Format the number
        if (Number.isInteger(numValue)) {
            return numValue.toString();
        } else {
            // Limit decimal places to avoid overflow
            const maxDecimalPlaces = 10;
            const rounded = parseFloat(numValue.toFixed(maxDecimalPlaces));
            return rounded.toString();
        }
    };

    const handleNumber = (number) => {
        // Handle decimal point
        if (number === "." && display.includes(".")) {
            return; // Prevent multiple decimal points
        }

        if (display === "0" && number !== ".") {
            setDisplay(number);
        } else if (display === "Error") {
            setDisplay(number);
        } else {
            // Limit display length to prevent overflow
            if (display.length < 12) {
                setDisplay(display + number);
            }
        }
    };

    const handleOperator = (operator) => {
        // Skip if previous input resulted in an error
        if (display === "Error") return;

        setLastOperation(operator);
        setEquation(display + " " + operator + " ");
        setDisplay("0");
    };

    const calculateResult = (expression) => {
        try {
            const tokens = expression.split(" ");
            let result = parseFloat(tokens[0]);

            for (let i = 1; i < tokens.length; i += 2) {
                const operator = tokens[i];
                const operand = parseFloat(tokens[i + 1]);

                if (isNaN(operand)) {
                    throw new Error("Invalid number");
                }

                switch (operator) {
                    case "+":
                        result += operand;
                        break;
                    case "-":
                        result -= operand;
                        break;
                    case "*":
                        result *= operand;
                        break;
                    case "/":
                        if (operand === 0) throw new Error("Division by zero");
                        result /= operand;
                        break;
                    default:
                        throw new Error("Invalid operator");
                }
            }
            return formatNumber(result);
        } catch (error) {
            return "Error";
        }
    };

    const handleEqual = () => {
        // Skip if previous input resulted in an error
        if (display === "Error") return;

        try {
            const result = calculateResult(equation + display);
            setDisplay(result);
            setEquation("");
            setLastOperation("");
        } catch (error) {
            setDisplay("Error");
        }
    };

    const handleClear = () => {
        setDisplay("0");
        setEquation("");
        setLastOperation("");
    };

    return (
        <div className="calculator-page">
            <h1 className="page-title ibm-plex-sans-regular">Calculator</h1>
            <div className="calculator-container">
                <div className="calculator-display">
                    <div className="equation">{equation}</div>
                    <div className="current">{display}</div>
                </div>
                <div className="calculator-buttons">
                    <button onClick={handleClear} className="clear">
                        C
                    </button>
                    <button onClick={() => handleOperator("/")} className={`operator ${lastOperation === "/" ? "active" : ""}`}>
                        ÷
                    </button>
                    <button onClick={() => handleNumber("7")} className="number-btn">
                        7
                    </button>
                    <button onClick={() => handleNumber("8")} className="number-btn">
                        8
                    </button>
                    <button onClick={() => handleNumber("9")} className="number-btn">
                        9
                    </button>
                    <button onClick={() => handleOperator("*")} className={`operator ${lastOperation === "*" ? "active" : ""}`}>
                        ×
                    </button>
                    <button onClick={() => handleNumber("4")} className="number-btn">
                        4
                    </button>
                    <button onClick={() => handleNumber("5")} className="number-btn">
                        5
                    </button>
                    <button onClick={() => handleNumber("6")} className="number-btn">
                        6
                    </button>
                    <button onClick={() => handleOperator("-")} className={`operator ${lastOperation === "-" ? "active" : ""}`}>
                        -
                    </button>
                    <button onClick={() => handleNumber("1")} className="number-btn">
                        1
                    </button>
                    <button onClick={() => handleNumber("2")} className="number-btn">
                        2
                    </button>
                    <button onClick={() => handleNumber("3")} className="number-btn">
                        3
                    </button>
                    <button onClick={() => handleOperator("+")} className={`operator ${lastOperation === "+" ? "active" : ""}`}>
                        +
                    </button>
                    <button onClick={() => handleNumber("0")} className="number-btn zero">
                        0
                    </button>
                    <button onClick={() => handleNumber(".")} className="number-btn">
                        .
                    </button>
                    <button onClick={handleEqual} className="equals">
                        =
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Calculator;
