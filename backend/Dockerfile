FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y libgl1 libglib2.0-0 curl && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir "bcrypt==4.0.1"
COPY . .
RUN chmod +x start.sh
EXPOSE 8000
CMD ["sh", "start.sh"]
