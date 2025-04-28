document.addEventListener("DOMContentLoaded", function () {
    const chatbotContainer = document.getElementById("chatbot-container");
    const clostBtn = document.getElementById("close-btn");
    const sendBtn = document.getElementById("send-btn");
    const chatBotInput = document.getElementById("chatbot-input");
    const chatbotMessages = document.getElementById("chatbot-messages");
    // const chatbotBody = document.getElementById("chatbot-body");
    // const chatbotIcon = document.getElementById("chatbot-icon");

    // chatbotIcon?.addEventListener("click", () => {
    //     chatbotContainer.classList.remove("hidden");
    //     chatbotIcon.style.display = "none";
    // });
    clostBtn.addEventListener("click", () => {
        // Removed hiding chatbot container as chatbot icon feature is removed
        // chatbotContainer.classList.add("hidden");
        // chatbotIcon.style.display = "flex";
    });

    sendBtn.addEventListener("click", sendMessage);

    chatBotInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            sendMessage();
        }
    });

    // Load conversation history from localStorage but do not render messages
    loadConversation();
});

// Conversation history to maintain context
let conversationHistory = [];
let typingMessageElement = null;

function saveConversation() {
    localStorage.setItem('chatbotConversation', JSON.stringify(conversationHistory));
}

function loadConversation() {
    const saved = localStorage.getItem('chatbotConversation');
    if (saved) {
        conversationHistory = JSON.parse(saved);
        // Do NOT append old messages to UI to avoid showing previous chat
    }
}

function sendMessage() {
    const userMessage = document.getElementById("chatbot-input").value.trim();
    if (userMessage) {
        appendMessage("user", userMessage);
        document.getElementById("chatbot-input").value = "";
        // Add user message to conversation history
        conversationHistory.push({ role: "user", content: userMessage });
        saveConversation();
        getBotResponse();
    }
}

function formatBotResponse(message) {
    const lines = message.split('\n');
    let html = '';
    let inList = false;

    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            if (!inList) {
                inList = true;
                html += '<ul>';
            }
            html += `<li>${trimmed.substring(2)}</li>`;
        } else {
            if (inList) {
                inList = false;
                html += '</ul>';
            }
            if (trimmed) {
                html += `<p>${trimmed}</p>`;
            }
        }
    });
    if (inList) {
        html += '</ul>';
    }
    return html;
}

function appendMessage(sender, message) {
    const messageContainer = document.getElementById("chatbot-messages");
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", sender);
    if (sender === "bot") {
        messageElement.innerHTML = formatBotResponse(message);
    } else {
        messageElement.textContent = message;
    }
    messageContainer.appendChild(messageElement);
    setTimeout(() => {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 50);
    return messageElement;
}

async function getBotResponse() {
    const API_KEY = "AIzaSyDpRhrTggwOc4WFM0nTyrSu79ezP1cyjgs";
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

    try {
        // Show typing indicator as a normal bot message bubble
        typingMessageElement = appendMessage("bot", "Medi is typing...");
        let conversationText = "";
        conversationHistory.forEach(msg => {
            // Remove "Medi:" prefix from conversationText to avoid duplication
            if (msg.role === "bot" && msg.content.startsWith("Medi:")) {
                conversationText += "Medi: " + msg.content.substring(5).trim() + "\n";
            } else {
                conversationText += (msg.role === "user" ? "User: " : "Medi: ") + msg.content + "\n";
            }
        });

        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [{ text: conversationText }],
                    },
                ],
            }),
        });

        const data = await response.json();

        if (!data.candidates || !data.candidates.length) {
            throw new Error("No response from Gemini API");
        }

        const botMessage = data.candidates[0].content.parts[0].text;
        // Replace typing indicator with actual message
        if (typingMessageElement) {
            // Remove duplicate "Medi:" prefix if present
            let cleanBotMessage = botMessage;
            if (cleanBotMessage.startsWith("Medi:")) {
                cleanBotMessage = cleanBotMessage.substring(5).trim();
            }
            typingMessageElement.innerHTML = formatBotResponse(cleanBotMessage);
            typingMessageElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
            typingMessageElement = null;
        } else {
            appendMessage("bot", botMessage);
        }
        conversationHistory.push({ role: "bot", content: botMessage });
        saveConversation();

        // Scroll to bottom after response
        const messageContainer = document.getElementById("chatbot-messages");
        requestAnimationFrame(() => {
            messageContainer.scrollTo({ top: messageContainer.scrollHeight, behavior: 'smooth' });
        });
    } catch (error) {
        console.error("Error:", error);
        if (typingMessageElement) {
            typingMessageElement.innerHTML = "Sorry, I'm having trouble responding. Please try again.";
            typingMessageElement = null;
        } else {
            appendMessage(
                "bot",
                "Sorry, I'm having trouble responding. Please try again."
            );
        }
    }
}
