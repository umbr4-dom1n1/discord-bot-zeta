# Overview

This is a Discord bot application designed for the Zeta Company military unit to manage training and supervisor assistance requests. The bot provides slash commands for members to request training sessions or supervisor assistance, with automatic scheduling, role-based permissions, and channel-specific routing. It serves as a centralized system for coordinating unit activities and maintaining operational readiness.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Bot Architecture
The application uses a single-file Discord.js bot (`index.js`) that handles slash command interactions for training and supervisor requests. The bot implements a command-response pattern with embedded message formatting for professional presentation of requests.

## Database Design
Uses SQLite with better-sqlite3 for local data persistence. The database stores request records with fields for request type, Discord identifiers, timestamps, and serialized request data. This lightweight approach eliminates external database dependencies while providing reliable data storage.

## Command Management
Implements separate deployment scripts for guild-specific (`deploy-guild.js`) and global (`deploy-command.js`) slash commands. This allows flexible command deployment strategies - testing in specific servers before global rollout. A cleanup script (`clear-global-commands.js`) provides command management capabilities.

## Role-Based Access Control
Uses Discord role IDs to implement permission-based access to different channels and features. The system defines specific roles for staff, officers, verified members, and special units, enabling granular control over who can access different functionalities.

## Channel Routing
Implements channel-specific routing based on request type and user roles. Training requests, supervisor requests, backup calls, and VIP protection requests are automatically directed to appropriate channels, ensuring proper workflow separation.

## Time Management
Integrates Luxon library for robust datetime handling with timezone support (America/Montreal). This ensures accurate scheduling across different user timezones and provides consistent time formatting.

## Message Formatting
Uses Discord.js EmbedBuilder for rich message formatting, creating professional-looking request notifications with color coding, structured fields, and clear visual hierarchy.

# External Dependencies

## Discord API
- **discord.js v14.22.1**: Primary Discord API wrapper for bot functionality, slash commands, and message handling
- **Discord Bot Token**: Required for authentication and API access

## Database
- **better-sqlite3 v12.2.0**: SQLite database driver for local data persistence without external database requirements

## Utilities
- **luxon v3.7.1**: DateTime library for timezone-aware date/time handling and formatting
- **node-fetch v2.7.0**: HTTP client for potential external API integrations
- **dotenv v17.2.2**: Environment variable management for secure configuration storage

## Configuration Requirements
- Discord application with bot permissions
- Channel IDs for different request types (training, supervisor, backup, VIP, untrained, chat)
- Role IDs for permission management
- Environment variables for Discord token and other sensitive configuration