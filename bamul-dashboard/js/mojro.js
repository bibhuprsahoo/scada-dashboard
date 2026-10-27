async function getMojroAuthToken() {
    try {
        // Call your backend API endpoint instead of Mojro directly
        const response = await fetch("/papi/mojro/token");
        if (!response.ok) {
            throw new Error(`Failed to fetch token from backend with status: ${response.status}`);
        }
        const data = await response.json();
        // Returns the token string from your backend response
        console.log(data);
        return data.token;
    } catch (error) {
        console.error("Error fetching Mojro token from backend:", error);
        return null;
    }
}

const iframe = document.getElementById("mojroIframe");

window.addEventListener("message", async (event) => {
    // Ensure message is coming from Mojro
    console.warn("Message Event from MOJRO", event.origin);
    if (!event.origin.includes("mojro.com")) return;

    const message = event.data;

    // Check if Mojro is asking for a token (on load or after a 401 expiry)
    if (message === "SHIPPER_READY" || message.type === "SHIPPER_TOKEN_REQUEST") {
        console.log("Mojro requested token. Fetching new token from backend...");

        // Fetch the token dynamically via your backend route
        const token = await getMojroAuthToken();
        console.warn("Retrieved Token:", token);

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
