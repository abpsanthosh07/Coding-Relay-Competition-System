# Use a lightweight Ubuntu base image
FROM ubuntu:22.04

# Avoid tzdata interactive prompt during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Update and install necessary compilers and runtimes
RUN apt-get update && apt-get install -y \
    python3 \
    gcc \
    openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user to run the code securely
RUN useradd -m coder
USER coder

# Set the working directory where host files will be mounted
WORKDIR /sandbox

# Keep container running temporarily (entrypoint will be overridden during execution)
CMD ["bash"]
