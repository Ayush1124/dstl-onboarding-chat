import { useEffect, useState } from "react";

type Message = {
  id?: number;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
};

type Conversation = {
  id: number;
  title?: string;
  created_at?: string;
};

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8100";

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    number | null
  >(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    // Fetch conversations on mount
    fetch(`${API_BASE}/conversations/`)
      .then((res) => res.json())
      .then((data) => setConversations(data))
      .catch((err) => console.error("Failed to load conversations", err));
  }, []);

  useEffect(() => {
    if (activeConversationId == null) return;

    // Fetch messages for selected conversation
    fetch(`${API_BASE}/conversations/${activeConversationId}/messages`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch messages");
        return res.json();
      })
      .then((data) => {
        // Map backend messages to local Message type
        const mapped: Message[] = data.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          created_at: m.created_at,
        }));
        setMessages(mapped);
      })
      .catch((err) => console.error("Failed to load messages", err));
  }, [activeConversationId]);

  const handleSend = async () => {
    const content = input.trim();
    if (!content) return;

    // Optimistically append the user's message and clear input immediately
    const localMsg: Message = {
      id: Date.now(),
      role: "user",
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, localMsg]);
    setInput("");

    try {
      // Ensure a conversation exists
      let convId = activeConversationId;
      if (convId == null) {
        const convRes = await fetch(`${API_BASE}/conversations/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!convRes.ok) throw new Error("Failed to create conversation");
        const conv = await convRes.json();
        setConversations((prev) => [conv, ...prev]);
        setActiveConversationId(conv.id);
        convId = conv.id;
      }

      // Send message to backend
      const msgRes = await fetch(
        `${API_BASE}/conversations/${convId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, role: "user" }),
        }
      );
      if (!msgRes.ok) throw new Error("Failed to send message");
      const data = await msgRes.json();

      // Append assistant message if provided by backend
      if (data && data.assistant) {
        setMessages((prev) => [...prev, data.assistant]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 text-white p-4 flex flex-col">
        <div className="mb-4">
          <h1 className="text-xl font-bold">DSTL Chat App</h1>
        </div>
        <button
          className="w-full py-2 px-4 border border-gray-600 rounded hover:bg-gray-800 text-left mb-4"
          onClick={() => {
            setActiveConversationId(null);
            setMessages([]);
          }}
        >
          + New Chat
        </button>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <div className="text-sm text-gray-400">No conversations yet</div>
          )}
          <ul>
            {conversations.map((c) => (
              <li
                key={c.id}
                className={`p-2 rounded mb-2 cursor-pointer hover:bg-gray-800 ${
                  activeConversationId === c.id ? "bg-gray-700" : ""
                }`}
                onClick={() => setActiveConversationId(c.id)}
              >
                <div className="font-medium">{c.title || `Chat ${c.id}`}</div>
                <div className="text-xs text-gray-400">
                  {new Date(c.created_at || "").toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-white">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-lg font-semibold">
              {activeConversationId
                ? conversations.find((c) => c.id === activeConversationId)
                    ?.title || `Chat ${activeConversationId}`
                : "New Chat"}
            </h2>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, index) => (
            <div
              key={msg.id ?? index}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[70%] rounded-lg p-3 ${
                  msg.role === "user"
                    ? "bg-blue-500 text-white"
                    : "bg-white border border-gray-200 text-gray-800"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {messages.length === 0 && (
            <div className="text-center text-gray-500 mt-20">
              <h2 className="text-2xl font-semibold">
                {activeConversationId
                  ? "No messages yet"
                  : "Welcome to the DSTL Chat App"}
              </h2>
              {!activeConversationId && <p>Start a conversation!</p>}
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-gray-200 bg-white">
          <div className="flex gap-4 max-w-4xl mx-auto">
            <textarea
              className="flex-1 border border-gray-300 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={1}
              placeholder="Type a message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              Send
            </button>
          </div>
          <div className="text-center text-xs text-gray-400 mt-2">
            Press Enter to send
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
