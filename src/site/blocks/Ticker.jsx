import React from "react";
import { stack } from "../../data/site";

export default function Ticker() {
    /* Two copies, so the loop is seamless when the first half scrolls off. */
    const items = [...stack, ...stack];
    return (
        <div className="ticker" aria-hidden="true">
            <div className="ticker__track">
                {items.map((item, i) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <span className="ticker__item" key={`${item}-${i}`}>
                        {item}
                    </span>
                ))}
            </div>
        </div>
    );
}
