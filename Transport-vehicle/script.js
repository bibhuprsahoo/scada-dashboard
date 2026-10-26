async function getMojroAuthToken() {
    try {
        const response = await fetch(
            "https://gateway.mojro.com/enterprise/v1/account/oauth/token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Ocp-Apim-Subscription-Key": "efd89678c93d40fc9e0c35f73280dba2",
                },
                body: JSON.stringify({
                    username: "bamull@integration.com",
                    password: "Bamul1234@",
                }),
            },
        );

        if (!response.ok) {
            throw new Error(`Authentication failed with status: ${response.status}`);
        }

        const data = await response.json();
        // Returns the token string from the response payload
        return data.token;
    } catch (error) {
        console.error("Error fetching Mojro token:", error);
        return null;
    }
}

const iframe = document.getElementById("mojroIframe");

window.addEventListener("message", async (event) => {
    // Ensure message is coming from Mojro
    
    console.warn("Message Event from MOJRO")
    if (!event.origin.includes("mojro.com")) return;
    const message = event.data;

    // Check if Mojro is asking for a token (on load or after a 401 expiry)
    if (message === "SHIPPER_READY" || message.type === "SHIPPER_TOKEN_REQUEST") {
        console.log("Mojro requested token. Fetching new token...");

        // Fetch the token dynamically using the credentials provided
        const token = await getMojroAuthToken();
        console.warn(token);
        if (token) {
            // Send the token back to the iframe
            iframe.contentWindow.postMessage(
                {
                    type: "SHIPPER_AUTH_SUCCESS",
                    token: token,
                },
                "https://shipper.mojro.com",
            );
        } else {
            // Handle error case if token generation fails
            iframe.contentWindow.postMessage(
                {
                    type: "SHIPPER_AUTH_ERROR",
                    message: "Failed to obtain authentication token from parent.",
                },
                "https://shipper.mojro.com",
            );
        }
    }
});
