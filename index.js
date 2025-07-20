require("dotenv").config();
// At the top of your server file
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const cors = require("cors");
const admin = require("firebase-admin");

const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const cron = require("node-cron");
app.use(cors());
app.use(express.json());

const serviceAccount = require("./NEXORA_FB_KEY.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("Nexora");

    const usersCollection = db.collection("allUsers");
    const apartmentsCollection = db.collection("allApartments");
    const agreementsCollection = db.collection("allAgreements");
    const rentPaymentsCollection = db.collection("allRentPayments");
    const announcementsCollection = db.collection("allAnnouncement");
    const couponsCollection = db.collection("allCoupons");

    // 🔐 Middlewares
    const verifyFireBaseToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = authHeader.split(" ")[1];

      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      //  verify the token here
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: "forbidden access" });
      }
    };

    //🔐 verify admin role
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      // used just for checking
      // if (!user || user.role === "admin") {

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //🔐 verify membar role
    const verifyMembar = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      // used just for checking
      // if (!user || user.role === "admin") {

      if (!user || user.role !== "member") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // ----------------------------------------------------------------
    //  🧮 apartments
    // ----------------------------------------------------------------

    // ✅ GET Apartments with pagination + rent filter
    app.get("/apartments", async (req, res) => {
      try {
        // 📌 Query params for pagination
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8; // fits better with grid-cols-4
        const skip = (page - 1) * limit;

        // 📌 Query params for filtering
        const minRent = parseInt(req.query.minRent) || 0;
        const maxRent = parseInt(req.query.maxRent) || 9999999;

        // 📌 Query params for sorting
        const sortBy = req.query.sortBy || "rent"; // default sort field
        const sortOrder = req.query.sortOrder === "desc" ? -1 : 1; // default ascending

        // 🔍 Build the MongoDB filter query
        const query = {
          rent: { $gte: minRent, $lte: maxRent },
        };

        // 🧮 Count total documents matching query
        const total = await apartmentsCollection.countDocuments(query);

        // 📦 Fetch paginated & sorted apartments
        const apartments = await apartmentsCollection
          .find(query)
          .sort({ [sortBy]: sortOrder }) // ✅ dynamic sorting
          .skip(skip)
          .limit(limit)
          .toArray();

        // ✅ Respond with paginated result
        res.json({
          success: true,
          total,
          page,
          pages: Math.ceil(total / limit),
          apartments,
        });
      } catch (err) {
        console.error(" GET /apartments error:", err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // ----------------------------------------------------------------
    //  ✅  agreements
    // ----------------------------------------------------------------

    // ✅ POST Agreement
    app.post("/agreements", verifyFireBaseToken, async (req, res) => {
      try {
        const { availability, userEmail, apartmentNo } = req.body;
        const agreementData = req.body;

        // Check availability
        if (availability === false) {
          return res.status(400).json({
            success: false,
            message: "Apartment Unavailable",
          });
        }

        // Validate required fields
        if (!userEmail || !apartmentNo) {
          return res.status(400).json({
            success: false,
            message: "Missing required fields",
          });
        }

        // Check if user already has a pending or accepted agreement
        const existing = await agreementsCollection.findOne({
          userEmail: userEmail,
          status: "pending",
        });
        if (existing) {
          return res.status(400).json({
            success: false,
            message: "Already applied for an apartment",
          });
        }

        // Add server-side defaults
        agreementData.status = "pending";
        agreementData.createdAt = new Date();

        await agreementsCollection.insertOne(agreementData);

        res.json({
          success: true,
          message: "Agreement request submitted successfully",
        });
      } catch (err) {
        console.error("POST /agreements error:", err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // ✅ GET pending agreements
    app.get(
      "/agreements",
      verifyFireBaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const status = req.query.status || "pending";
          const agreements = await agreementsCollection
            .find({ status })
            .toArray();
          res.json(agreements);
        } catch (err) {
          console.error("GET /agreements error:", err);
          res.status(500).json({ success: false, message: "Server error" });
        }
      }
    );

    // ✅ PATCH Agreement (Accept/Reject)
    app.patch(
      "/agreements/:id",
      verifyFireBaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { action, userEmail } = req.body;

          const agreement = await agreementsCollection.findOne({
            _id: new ObjectId(id),
          });
          if (!agreement) {
            return res
              .status(404)
              .json({ success: false, message: "Agreement not found" });
          }

          let newStatus;

          if (action === "accept") {
            newStatus = "accepted";

            // ✅ Update user role
            await usersCollection.updateOne(
              { email: userEmail },
              { $set: { role: "member" } }
            );

            // ✅ Mark apartment unavailable
            if (agreement.apartmentId) {
              await apartmentsCollection.updateOne(
                { _id: new ObjectId(agreement.apartmentId) },
                { $set: { available: false } }
              );
            }

            // ✅ Create initial unpaid rent
            const monthName = new Date().toLocaleString("default", {
              month: "long",
              year: "numeric",
            });

            await rentPaymentsCollection.insertOne({
              userEmail,
              apartmentId: agreement.apartmentId,
              month: monthName,
              amount: agreement.rent,
              status: "unpaid",
              generatedAt: new Date(),
            });

            // ✅ Add apartmentId to rentHistory
            const nextDate = new Date();
            nextDate.setMonth(nextDate.getMonth() + 1);
            await usersCollection.updateOne(
              { email: userEmail },
              {
                $set: { nextRentDate: nextDate },
                $push: {
                  rentHistory: {
                    month: monthName,
                    amount: agreement.rent,
                    apartmentId: agreement.apartmentId, // ✅ added
                    status: "unpaid",
                    createdAt: new Date(),
                  },
                },
              }
            );
          } else if (action === "reject") {
            newStatus = "rejected";
            if (agreement.apartmentId) {
              await apartmentsCollection.updateOne(
                { _id: new ObjectId(agreement.apartmentId) },
                { $set: { available: true } }
              );
            }
          } else {
            return res
              .status(400)
              .json({ success: false, message: "Invalid action" });
          }

          await agreementsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: newStatus, decisionAt: new Date() } }
          );

          res.json({ success: true, message: `Agreement ${newStatus}` });
        } catch (err) {
          console.error("PATCH /agreements/:id error:", err);
          res.status(500).json({ success: false, message: "Server error" });
        }
      }
    );

    cron.schedule("0 1 1 * *", async () => {
      console.log("⏰ Running monthly rent generation...");
      const now = new Date();

      const dueUsers = await usersCollection
        .find({ role: "member", nextRentDate: { $lte: now } })
        .toArray();

      for (const u of dueUsers) {
        const lastRent = u.rentHistory?.[u.rentHistory.length - 1];
        if (!lastRent || !lastRent.apartmentId) continue; // ✅ ensure we have apartmentId

        await rentPaymentsCollection.insertOne({
          userEmail: u.email,
          apartmentId: lastRent.apartmentId,
          month: now.toLocaleString("default", {
            month: "long",
            year: "numeric",
          }),
          amount: lastRent.amount,
          generatedAt: now,
          status: "unpaid",
        });

        const nextDate = new Date(now);
        nextDate.setMonth(nextDate.getMonth() + 1);
        await usersCollection.updateOne(
          { email: u.email },
          {
            $set: { nextRentDate: nextDate },
            $push: {
              rentHistory: {
                month: now.toLocaleString("default", {
                  month: "long",
                  year: "numeric",
                }),
                amount: lastRent.amount,
                apartmentId: lastRent.apartmentId, // ✅ include apartmentId
                status: "unpaid",
                createdAt: now,
              },
            },
          }
        );
      }
    });

    // ✅ GET agreements by user email
    app.get(
      "/agreements/user/:email",
      verifyFireBaseToken,
      async (req, res) => {
        try {
          const email = req.params.email;
          const status = req.query.status;

          const filter = { userEmail: email };
          if (status) filter.status = status;

          const result = await agreementsCollection.find(filter).toArray();
          res.json(result); // clean and explicit
        } catch (err) {
          console.error("GET /agreements/user/:email error:", err);
          res.status(500).json({ message: "Server error" });
        }
      }
    );

    // ----------------------------------------------------------------
    // ✅ USERS ROUTES
    // ----------------------------------------------------------------
    // post an user to db
    app.post("/users", async (req, res) => {
      const { email, role, last_log_in, created_at } = req.body;
      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }
      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        const updateResult = await usersCollection.updateOne(
          { email },
          { $set: { last_log_in } }
        );
        return res.status(200).send({
          message: "User already exists, last_log_in updated",
          inserted: false,
          updated: updateResult.modifiedCount > 0,
        });
      }
      // New user — insert all data
      const user = {
        email,
        role: role || "user",
        last_log_in,
        created_at,
      };
      const insertResult = await usersCollection.insertOne(user);
      return res.status(201).send({
        message: "New user created",
        inserted: true,
        result: insertResult,
      });
    });

    // ✅ Get user role by email
    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;
        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const user = await usersCollection.findOne({ email });

        if (!user) {
          // default role if not found
          return res.json({ role: "user" });
        }

        res.json({ role: user.role || "user" });
      } catch (error) {
        console.error("Error fetching user role:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // ----------------------------------------------------------------
    // 🎟️ COUPONS ROUTES
    // ----------------------------------------------------------------

    // ✅ Validate coupon
    app.post(
      "/coupons/validate",
      verifyFireBaseToken,
      verifyMembar,
      async (req, res) => {
        try {
          const { code } = req.body;

          if (!code) {
            return res
              .status(400)
              .json({ valid: false, message: "Coupon code required" });
          }

          // 🔎 Find coupon in database
          const coupon = await couponsCollection.findOne({ code: code.trim() });

          if (!coupon) {
            return res
              .status(404)
              .json({ valid: false, message: "Coupon not found" });
          }

          // ✅ Check expiry date here
          if (coupon.expiryDate && new Date() > new Date(coupon.expiryDate)) {
            return res
              .status(400)
              .json({ valid: false, message: "Coupon expired" });
          }

          // ✅ If valid, return discount info
          return res.json({
            valid: true,
            discountPercent: coupon.discount,
            description: coupon.description,
            expiryDate: coupon.expiryDate, // include expiry date in response if needed
          });
        } catch (err) {
          console.error("POST /coupons/validate error:", err);
          res.status(500).json({ valid: false, message: "Server error" });
        }
      }
    );

    // Get all coupons
    app.get("/coupons", async (req, res) => {
      try {
        const coupons = await couponsCollection.find().toArray();
        res.send(coupons);
      } catch (err) {
        console.error("GET /coupons error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Add a new coupon
    app.post("/coupons", verifyFireBaseToken, verifyAdmin, async (req, res) => {
      try {
        const { code, discount, description, expiryDate } = req.body;
        if (!code || !discount || !description || !expiryDate) {
          return res
            .status(400)
            .json({ message: "All fields are required, including expiryDate" });
        }

        // Check if coupon code already exists
        const exists = await couponsCollection.findOne({ code });
        if (exists) {
          return res
            .status(400)
            .json({ message: "Coupon code already exists" });
        }

        // Prepare coupon data
        const couponData = {
          code,
          discount,
          description,
          expiryDate: new Date(expiryDate), // save expiryDate as Date object
          createdAt: new Date(),
        };

        await couponsCollection.insertOne(couponData);
        res.json({ success: true, message: "Coupon added successfully" });
      } catch (err) {
        console.error("POST /coupons error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Update coupon (add this to support edit)
    app.put(
      "/coupons/:id",
      verifyFireBaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const couponId = req.params.id;
          const { code, discount, description, expiryDate } = req.body;

          if (!code || !discount || !description || !expiryDate) {
            return res.status(400).json({
              message: "All fields are required, including expiryDate",
            });
          }

          // Check if another coupon with same code exists (exclude current coupon)
          const exists = await couponsCollection.findOne({
            code,
            _id: { $ne: new ObjectId(couponId) },
          });
          if (exists) {
            return res
              .status(400)
              .json({ message: "Coupon code already exists" });
          }

          const updateResult = await couponsCollection.updateOne(
            { _id: new ObjectId(couponId) },
            {
              $set: {
                code,
                discount,
                description,
                expiryDate: new Date(expiryDate),
                updatedAt: new Date(),
              },
            }
          );

          if (updateResult.matchedCount === 0) {
            return res.status(404).json({ message: "Coupon not found" });
          }

          res.json({ success: true, message: "Coupon updated successfully" });
        } catch (err) {
          console.error("PUT /coupons/:id error:", err);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    // Delete coupon (add this if you want to support deletion)
    app.delete(
      "/coupons/:id",
      verifyFireBaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const couponId = req.params.id;
          const deleteResult = await couponsCollection.deleteOne({
            _id: new ObjectId(couponId),
          });

          if (deleteResult.deletedCount === 0) {
            return res.status(404).json({ message: "Coupon not found" });
          }

          res.json({ success: true, message: "Coupon deleted successfully" });
        } catch (err) {
          console.error("DELETE /coupons/:id error:", err);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    // ----------------------------------------------------------------
    // 💸 RENT ROUTES
    // ----------------------------------------------------------------

    // ✅ Create payment intent (protected)
    app.post(
      "/create-payment-intent",
      verifyFireBaseToken,
      async (req, res) => {
        try {
          const { amountInCents, userEmail, apartmentNo, fullName } = req.body;

          if (!amountInCents || amountInCents <= 0) {
            return res.status(400).json({ message: "Invalid amount" });
          }

          // ✅ (optional) log or validate extra info
          console.log("Creating payment intent for:", {
            userEmail,
            apartmentNo,
            fullName,
            amountInCents,
          });

          const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: "bdt",
            payment_method_types: ["card"],
            metadata: {
              userEmail: userEmail || "",
              apartmentNo: apartmentNo || "",
              fullName: fullName || "",
            }, 
          });

          res.send({ clientSecret: paymentIntent.client_secret });
        } catch (error) {
          console.error("Payment Intent Error:", error);
          res.status(500).send({ message: "Failed to create payment intent" });
        }
      }
    );

    // ✅ Record rent payment (manual trigger, kept for compatibility)
    app.post("/rent-payments", verifyFireBaseToken, async (req, res) => {
      try {
        const { userEmail, apartmentId, month, amount } = req.body;

        if (!userEmail || !apartmentId || !month || !amount) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        const unpaid = await rentPaymentsCollection.findOne({
          userEmail,
          apartmentId,
          month,
          status: "unpaid",
        });

        if (!unpaid) {
          return res.status(400).json({
            message: "No unpaid rent found for this apartment and month",
          });
        }

        await rentPaymentsCollection.updateOne(
          { _id: unpaid._id },
          {
            $set: {
              status: "paid",
              paidAt: new Date(),
              amount,
              transactionId: result.paymentIntent.id, // ✅ save transaction ID
            },
          }
        );

        await usersCollection.updateOne(
          {
            email: userEmail,
            "rentHistory.month": month,
            "rentHistory.apartmentId": apartmentId,
          },
          { $set: { "rentHistory.$.status": "paid" } }
        );

        res.json({ success: true, message: "Payment recorded successfully" });
      } catch (err) {
        console.error("POST /rent-payments error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // ✅ Get rent payments for a user
    app.get("/rent-payments/:email", verifyFireBaseToken, async (req, res) => {
      try {
        const email = req.params.email;
        const status = req.query.status;

        const filter = { userEmail: email };
        if (status) filter.status = status;

        const rents = await rentPaymentsCollection.find(filter).toArray();
        res.json(rents);
      } catch (err) {
        console.error("GET /rent-payments/:email error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // ✅ Update a rent payment status
    app.patch("/rent-payments/:id", verifyFireBaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const { status,transactionId } = req.body;

        const updateResult = await rentPaymentsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: status || "paid",
              paidAt: new Date(),
              transactionId: transactionId,
            },
          }
        );

        if (updateResult.matchedCount === 0) {
          return res.status(404).json({ message: "Rent record not found" });
        }

        const rentPayment = await rentPaymentsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!rentPayment) {
          return res
            .status(404)
            .json({ message: "Rent payment not found after update" });
        }

        await usersCollection.updateOne(
          {
            email: rentPayment.userEmail,
            "rentHistory.month": rentPayment.month,
            "rentHistory.apartmentId": rentPayment.apartmentId,
          },
          { $set: { "rentHistory.$.status": "paid" } }
        );

        res.json({
          success: true,
          message: "Rent marked as paid and user rentHistory updated",
        });
      } catch (err) {
        console.error("PATCH /rent-payments/:id error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // ----------------------------------------------------------------
    //  ANNOUNCEMENTS ROUTES
    // ----------------------------------------------------------------

    // GET all announcements
    app.get("/announcements", verifyFireBaseToken, async (req, res) => {
      const data = await announcementsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(data);
    });

    // POST new announcement (admin only)
    app.post(
      "/announcements",
      verifyFireBaseToken,
      verifyAdmin,
      async (req, res) => {
        const body = req.body;
        const result = await announcementsCollection.insertOne(body);
        res.send(result);
      }
    );

    app.patch(
      "/announcements/:id",
      verifyFireBaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { title, description } = req.body;

          if (!title || !description) {
            return res
              .status(400)
              .json({ success: false, message: "All fields are required" });
          }

          const result = await announcementsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                title,
                description,
                updatedAt: new Date(),
              },
            }
          );

          if (result.modifiedCount === 0) {
            return res.status(404).json({
              success: false,
              message: "Announcement not found or unchanged",
            });
          }

          res.json({
            success: true,
            message: "Announcement updated successfully",
          });
        } catch (err) {
          console.error("PATCH /announcements/:id error:", err);
          res.status(500).json({ success: false, message: "Server error" });
        }
      }
    );

    app.delete(
      "/announcements/:id",
      verifyFireBaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;

          const result = await announcementsCollection.deleteOne({
            _id: new ObjectId(id),
          });
          if (result.deletedCount === 0) {
            return res
              .status(404)
              .json({ success: false, message: "Announcement not found" });
          }

          res.json({
            success: true,
            message: "Announcement deleted successfully",
          });
        } catch (err) {
          console.error("DELETE /announcements/:id error:", err);
          res.status(500).json({ success: false, message: "Server error" });
        }
      }
    );

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
