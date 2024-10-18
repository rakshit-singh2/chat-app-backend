# Project Setup

## Environment Configuration

Before running the application, you need to create a configuration file to store your environment variables.

### Step 1: Create a `.env` File

1. In the root directory of your project, create a new file named `.env`.
   
2. Add the following environment variables to the `.env` file:

   ```plaintext
   PORT=3000  # The port your server will run on (default: 3000)
   DATABASE_PASSWORD=your_database_password  # Your MongoDB database password
   DATABASE=mongodb+srv://<username>:<password>@cluster0.mongodb.net/<dbname>?retryWrites=true&w=majority  # Your MongoDB connection string
   JWT_SECRET=your_jwt_secret  # Secret key for JWT signing
   ZEGO_APP_ID=your_zego_app_id  # Zego application ID
   ZEGO_SERVER_SECRET=your_zego_server_secret  # Zego server secret key
