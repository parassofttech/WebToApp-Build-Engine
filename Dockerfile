
FROM node:22-bookworm

ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH="${JAVA_HOME}/bin:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

RUN apt-get update && apt-get install -y \
    openjdk-21-jdk \
    wget \
    unzip \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p "${ANDROID_HOME}/cmdline-tools" \
    && wget https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/cmdtools.zip \
    && unzip -q /tmp/cmdtools.zip -d "${ANDROID_HOME}/cmdline-tools" \
    && mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest" \
    && rm /tmp/cmdtools.zip

RUN yes | sdkmanager --sdk_root="${ANDROID_HOME}" --licenses \
    && sdkmanager --sdk_root="${ANDROID_HOME}" \
       "platform-tools" \
       "platforms;android-36" \
       "build-tools;36.0.0"

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN java -version && javac -version \
    && test -x "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager"

EXPOSE 5001

CMD ["node", "server.js"]





# FROM node:22-bookworm

# # Java JDK aur system dependencies install karein
# RUN apt-get update && apt-get install -y \
#     default-jdk \
#     wget \
#     unzip \
#     git \
#     && rm -rf /var/lib/apt/lists/*

# # Android SDK Environment Variables
# ENV JAVA_HOME=/usr/lib/jvm/default-java
# ENV ANDROID_HOME=/opt/android-sdk
# ENV ANDROID_SDK_ROOT=/opt/android-sdk
# ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

# # Android Command Line Tools setup
# RUN mkdir -p ${ANDROID_HOME}/cmdline-tools \
#     && wget https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip -O /tmp/cmdtools.zip \
#     && unzip /tmp/cmdtools.zip -d ${ANDROID_HOME}/cmdline-tools \
#     && mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest \
#     && rm /tmp/cmdtools.zip

# # Android SDK licenses accept karein aur platform/build tools install karein
# RUN yes | sdkmanager --licenses \
#     && sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# WORKDIR /app

# COPY package*.json ./
# RUN npm install

# COPY . .

# EXPOSE 5001

# CMD ["node", "server.js"]




