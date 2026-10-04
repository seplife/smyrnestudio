"""Point d'entrée : API sous /api + interface web compilée (frontend/dist)."""
import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from api import app as api_app

app = FastAPI(title="CHOIR AI STUDIO")
app.mount("/api", api_app)
_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="web")
