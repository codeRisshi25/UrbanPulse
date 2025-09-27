#!/bin/bash

# Load the project-specific aliases
source "$(dirname "$0")/conf/.dev_aliases"

# Provide feedback to the user
echo "✅ Conductor environment activated."
echo "   Available aliases: dcu, dcd, dcr, dcl, dca, ping-api"
echo "   Run 'deactivate' to remove them."

# Define a function to deactivate the environment
deactivate() {
    # Call the cleanup function from our alias file
    cleanup_aliases
    
    # Remove the deactivate function itself
    unset -f deactivate
    unset -f cleanup_aliases

    echo "🔴 Conductor environment deactivated."
}