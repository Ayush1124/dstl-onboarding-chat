import os
from contextlib import asynccontextmanager
from typing import List

import openai
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from .database import create_db_and_tables, get_session, seed_db
from .models import Conversation, Message


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    seed_db()
    yield


# Load environment variables (NRP API key) if present
load_dotenv()
API_KEY = os.getenv("NRP_API_KEY")
if openai is not None and API_KEY:
    openai.api_key = API_KEY


app = FastAPI(lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/conversations/", response_model=Conversation)
def create_conversation(
    conversation: Conversation, session: Session = Depends(get_session)
):
    session.add(conversation)
    session.commit()
    session.refresh(conversation)

    # If no title provided, set a default title using the assigned ID
    if not conversation.title:
        conversation.title = f"Conversation {conversation.id}"
        session.add(conversation)
        session.commit()
        session.refresh(conversation)

    return conversation


@app.get("/conversations/", response_model=List[Conversation])
def read_conversations(
    offset: int = 0, limit: int = 100, session: Session = Depends(get_session)
):
    conversations = session.exec(
        select(Conversation).offset(offset).limit(limit)
    ).all()
    return conversations


@app.get("/conversations/{conversation_id}", response_model=Conversation)
def read_conversation(
    conversation_id: int, session: Session = Depends(get_session)
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: int, session: Session = Depends(get_session)
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    session.delete(conversation)
    session.commit()
    return {"ok": True}


@app.get("/conversations/{conversation_id}/messages", response_model=List[Message])
def read_conversation_messages(
    conversation_id: int, session: Session = Depends(get_session)
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = session.exec(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
    ).all()
    return messages


@app.post("/conversations/{conversation_id}/messages")
def create_message(
    conversation_id: int, message: Message, session: Session = Depends(get_session)
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Ensure the user message is linked to the conversation and persist it
    message.conversation_id = conversation_id
    session.add(message)
    session.commit()
    session.refresh(message)

    # Build conversation history for the LLM
    history = session.exec(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
    ).all()

    llm_messages = []
    for m in history:
        role = m.role if m.role in ("user", "assistant") else "user"
        llm_messages.append({"role": role, "content": m.content})

    assistant_msg = None

    # Call the OpenAI / NRP LLM using the new OpenAI client (openai>=1.0).
    if openai is not None and API_KEY:
        try:
            model_name = "gemma3"

            # Create a client using the provided API key
            client = openai.OpenAI(api_key=API_KEY, base_url="https://ellm.nrp-nautilus.io/v1")

            # The new client uses `client.chat.completions.create` to make chat completions
            resp = client.chat.completions.create(model=model_name, messages=llm_messages)

            # Extract assistant text from the response
            try:
                assistant_text = resp.choices[0].message.content
            except Exception:
                try:
                    assistant_text = resp["choices"][0]["message"]["content"]
                except Exception:
                    assistant_text = str(resp)
        except Exception as e:
            assistant_text = f"[LLM error] {str(e)}"
    else:
        assistant_text = "[LLM not configured]"

    # Persist assistant response
    assistant_msg = Message(conversation_id=conversation_id, role="assistant", content=assistant_text)
    session.add(assistant_msg)
    session.commit()
    session.refresh(assistant_msg)

    return {"user": message, "assistant": assistant_msg}
