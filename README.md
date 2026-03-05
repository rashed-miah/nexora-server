# 🏢 Nexora Backend

**Nexora Backend** is the server-side application for the Nexora Apartment Management System.  
It provides secure REST APIs for apartments, agreements, users, coupons, announcements, rent payments, and admin dashboards.

---

![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)
![Express](https://img.shields.io/badge/Express.js-4.x-lightgrey?logo=express)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-brightgreen?logo=mongodb)
![Stripe](https://img.shields.io/badge/Stripe-Payments-blue?logo=stripe)
![Firebase Admin](https://img.shields.io/badge/Firebase-Admin-yellow?logo=firebase)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ Features

✅ **JWT-like verification via Firebase Admin SDK**  
✅ **Role-based routes (admin / member)**  
✅ **Apartments CRUD with pagination and filtering**  
✅ **Agreements workflow (request, approve/reject)**  
✅ **Coupons management and validation**  
✅ **Rent payment management with Stripe**  
✅ **Automatic monthly rent generation via cron**  
✅ **Announcements management (admin)**  
✅ **Admin dashboard statistics (aggregated)**

---

## 🛠️ Tech Stack

| Tech                  | Purpose                   |
| --------------------- | ------------------------- |
| ⚡ Express.js         | API framework             |
| 🍃 MongoDB Atlas      | Database                  |
| 🔐 Firebase Admin SDK | Auth & role verification  |
| 💳 Stripe             | Secure payments           |
| 🕒 Node-cron          | Automated rent generation |
| 🔗 CORS & Middleware  | API security              |

---

## 📦 Installation process

1. **Clone the repository**

```bash
git clone https://github.com/rashed-miah/nexora-server
cd nexora-backend



2. Install dependencies
npm install



⚙️ Environment Variables
Create a .env file in the root with:


PORT=5000
MONGODB_URI=your_mongodb_connection_string
STRIPE_SECRET_KEY=your_stripe_secret_key

# Firebase Admin service account key (Base64 encoded JSON)
FB_SERVICE_KEY=your_base64_encoded_service_account_json



Tip:
To get FB_SERVICE_KEY, encode your Firebase service account JSON:
cat serviceAccount.json | base64



🚀 Development
Run locally with:
npm run dev
Your backend will run on http://localhost:5000.





⏰ Cron Jobs
✅ Monthly Rent Generation
A cron runs every month (0 1 1 * *) to:

Insert unpaid rent records for each member

Update their nextRentDate

Push to their rentHistory





# Nexora Backend - API Tables

Below is a comprehensive list of all endpoints (A to Z) in table format.

## Users

| Method | Endpoint             | Description           | Auth   |
| ------ | -------------------- | --------------------- | ------ |
| POST   | `/users`             | Create or update user | Public |
| GET    | `/users/:email/role` | Get user role         | Public |

## Apartments

| Method | Endpoint                                                                      | Description                              | Auth   |
| ------ | ----------------------------------------------------------------------------- | ---------------------------------------- | ------ |
| GET    | `/apartments?page=1&limit=8&minRent=0&maxRent=5000&sortBy=rent&sortOrder=asc` | Get apartments with pagination & filters | Public |

## Agreements

| Method | Endpoint                     | Description                | Auth           |
| ------ | ---------------------------- | -------------------------- | -------------- |
| POST   | `/agreements`                | Submit agreement request   | Firebase Token |
| GET    | `/agreements?status=pending` | List agreements by status  | Admin          |
| PATCH  | `/agreements/:id`            | Accept or reject agreement | Admin          |
| GET    | `/agreements/user/:email`    | Get user’s agreements      | Firebase Token |

## Coupons

| Method | Endpoint            | Description      | Auth   |
| ------ | ------------------- | ---------------- | ------ |
| GET    | `/coupons`          | List all coupons | Public |
| POST   | `/coupons`          | Add new coupon   | Admin  |
| PUT    | `/coupons/:id`      | Update coupon    | Admin  |
| DELETE | `/coupons/:id`      | Delete coupon    | Admin  |
| POST   | `/coupons/validate` | Validate coupon  | Member |

## Rent Payments

| Method | Endpoint                 | Description                  | Auth           |
| ------ | ------------------------ | ---------------------------- | -------------- |
| POST   | `/create-payment-intent` | Create Stripe payment intent | Firebase Token |
| POST   | `/rent-payments`         | Record payment               | Firebase Token |
| GET    | `/rent-payments/:email`  | Get user’s rent payments     | Firebase Token |
| PATCH  | `/rent-payments/:id`     | Update payment status        | Firebase Token |

## Announcements

| Method | Endpoint             | Description         | Auth           |
| ------ | -------------------- | ------------------- | -------------- |
| GET    | `/announcements`     | List announcements  | Firebase Token |
| POST   | `/announcements`     | Add announcement    | Admin          |
| PATCH  | `/announcements/:id` | Edit announcement   | Admin          |
| DELETE | `/announcements/:id` | Delete announcement | Admin          |

## Admin Dashboard

| Method | Endpoint                     | Description                          | Auth  |
| ------ | ---------------------------- | ------------------------------------ | ----- |
| GET    | `/members`                   | Get members list with agreement info | Admin |
| PATCH  | `/members/:email/remove`     | Remove member (free apartment)       | Admin |
| GET    | `/members/:email/due-months` | Get unpaid months for member         | Admin |
| GET    | `/admin/stats`               | Get overall stats                    | Admin |

---

## Cron Jobs

| Schedule    | Description                                                                           |
| ----------- | ------------------------------------------------------------------------------------- |
| `0 1 1 * *` | Every month, generate unpaid rent records for members and update their next rent date |

---

This document lists all endpoints, routes, and cron information. You can download this as a README or integrate it into your documentation site.

**Let me know if you want:**

* OpenAPI/Swagger JSON
* Postman Collection (export)
* Markdown with examples of requests/responses
* Or a Dockerfile for deployment!



🔧 Deployment
You can deploy to services like Render, Railway, or Vercel (serverless).

Quick Deploy on Render:
Create new Web Service
Set build command: npm install
Set start command: node server.js
Add environment variables in Render dashboard



🤝 Contributing
Contributions welcome!
Fork the repo
Create a branch (git checkout -b feature/new)
Commit (git commit -m "feat: added X")
Push & open a PR 🚀



📜 License
This project is under the MIT License.
Feel free to use, modify, and distribute.



💡 About
Backend for Nexora Apartment Management with full-featured APIs, Stripe integration, and cron-powered rent management.

```
