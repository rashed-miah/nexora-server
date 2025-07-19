require("dotenv").config();
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
    const announcementCollection = db.collection("allAnnouncement");
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

      // Find the agreement first to know which apartment it refers to
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

        // ✅ Update user role to member
        await usersCollection.updateOne(
          { email: userEmail },
          { $set: { role: "member" } }
        );

        // ✅ Update apartment availability to false
        if (agreement.apartmentId) {
          await apartmentsCollection.updateOne(
            { _id: new ObjectId(agreement.apartmentId) },
            { $set: { available: false } }
          );
        }

        // ✅ Create initial unpaid rent record
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

        // ✅ Update user's profile rent history
        const nextDate = new Date();
        nextDate.setMonth(nextDate.getMonth() + 1); // next rent due in 1 month
        await usersCollection.updateOne(
          { email: userEmail },
          {
            $set: { nextRentDate: nextDate },
            $push: {
              rentHistory: {
                month: monthName,
                amount: agreement.rent,
                status: "unpaid",
                createdAt: new Date(),
              },
            },
          }
        );

      } else if (action === "reject") {
        newStatus = "rejected";

        // ✅ Keep apartment available
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

      // ✅ Update agreement status and decision time
      await agreementsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: newStatus,
            decisionAt: new Date(),
          },
        }
      );

      res.json({
        success: true,
        message: `Agreement ${newStatus}`,
      });
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
    if (!lastRent) continue;

    // ➡️ Insert new unpaid rent
    await rentPaymentsCollection.insertOne({
      userEmail: u.email,
      apartmentId: lastRent.apartmentId,
      month: now.toLocaleString("default", { month: "long", year: "numeric" }),
      amount: lastRent.amount,
      generatedAt: now,
      status: "unpaid",
    });

    // ➡️ Update nextRentDate & rentHistory
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

    // app.get(
    //   "/users/:email/unpaid-rents",
    //   verifyFireBaseToken,
    //   async (req, res) => {
    //     const { email } = req.params;
    //     try {
    //       const user = await usersCollection.findOne({ email });
    //       if (!user) return res.status(404).json({ message: "User not found" });

    //       const unpaid = (user.rentHistory || []).filter(
    //         (entry) => entry.status !== "paid"
    //       );
    //       res.json(unpaid);
    //     } catch (err) {
    //       console.error("GET /users/:email/unpaid-rents error:", err);
    //       res.status(500).json({ message: "Server error" });
    //     }
    //   }
    // );

    // PATCH: update a user's role (secure)
    // app.patch("/users/:email/role", verifyFireBaseToken, async (req, res) => {
    //   try {
    //     const email = req.params.email;
    //     const { role } = req.body;
    //     if (!role) {
    //       return res
    //         .status(400)
    //         .json({ message: "Missing role in request body" });
    //     }
    //     // Find user first
    //     const user = await usersCollection.findOne({ email });
    //     if (!user) {
    //       return res.status(404).json({ message: "User not found" });
    //     }
    //     // If downgrading to "user", perform extra cleanup
    //     if (role === "user") {
    //       // 1️⃣ Find accepted agreement for this user
    //       const acceptedAgreement = await agreementsCollection.findOne({
    //         userEmail: email,
    //         status: "accepted",
    //       });
    //       if (acceptedAgreement) {
    //         // 2️⃣ Mark apartment as available again
    //         await apartmentsCollection.updateOne(
    //           {
    //             apartmentNo: acceptedAgreement.apartmentNo,
    //             block: acceptedAgreement.block,
    //           },
    //           { $set: { available: true }, $unset: { rentedBy: "" } }
    //         );
    //         // 3️⃣ Remove or update agreement
    //         await agreementsCollection.deleteOne({
    //           _id: acceptedAgreement._id,
    //         });
    //       }
    //     }
    //     // Update user role
    //     const result = await usersCollection.updateOne(
    //       { email: email },
    //       { $set: { role: role } }
    //     );

    //     if (result.matchedCount === 0) {
    //       return res.status(404).json({ message: "User not found" });
    //     }
    //     return res.json({
    //       message: `Role was set to '${role}'`,
    //       modifiedCount: result.modifiedCount,
    //     });
    //   } catch (err) {
    //     console.error("PATCH /users/:email/role error:", err);
    //     res.status(500).json({ message: "Server error while updating role" });
    //   }
    // });

    // ----------------------------------------------------------------
    // 🎟️ COUPONS ROUTES
    // ----------------------------------------------------------------

    // ✅ Validate coupon
    app.post("/coupons/validate", verifyFireBaseToken, async (req, res) => {
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
        });
      } catch (err) {
        console.error("POST /coupons/validate error:", err);
        res.status(500).json({ valid: false, message: "Server error" });
      }
    });

    app.get("/coupons", async (req, res) => {
      try {
        const coupons = await couponsCollection.find().toArray();
        res.send(coupons);
      } catch (err) {
        console.error("GET /coupons error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.post("/coupons", verifyFireBaseToken, verifyAdmin, async (req, res) => {
      try {
        const { code, discount, description } = req.body;
        if (!code || !discount || !description) {
          return res.status(400).json({ message: "All fields are required" });
        }

        const exists = await couponsCollection.findOne({ code });
        if (exists) {
          return res
            .status(400)
            .json({ message: "Coupon code already exists" });
        }

        const couponData = {
          code,
          discount,
          description,
          createdAt: new Date(),
        };

        await couponsCollection.insertOne(couponData);
        res.json({ success: true, message: "Coupon added successfully" });
      } catch (err) {
        console.error("POST /coupons error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ----------------------------------------------------------------
    // 💸 RENT ROUTES
    // ----------------------------------------------------------------

    
  // ✅ POST: Record a rent payment (mark as paid)
app.post("/rent-payments", verifyFireBaseToken, async (req, res) => {
  try {
    const { userEmail, apartmentId, month, amount } = req.body;

    if (!userEmail || !apartmentId || !month || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Check if already paid for this month
    const alreadyPaid = await rentPaymentsCollection.findOne({
      userEmail,
      apartmentId,
      month,
      status: "paid", // only consider already-paid records
    });

    if (alreadyPaid) {
      return res.status(400).json({ message: "Rent already paid for this month" });
    }

    // Update or insert payment as paid
    const result = await rentPaymentsCollection.updateOne(
      { userEmail, apartmentId, month },
      {
        $set: {
          userEmail,
          apartmentId,
          month,
          amount,
          status: "paid",
          paidAt: new Date(),
        },
      },
      { upsert: true } // create if not exists
    );

    // Update user's rent history status
    await usersCollection.updateOne(
      { email: userEmail, "rentHistory.month": month },
      { $set: { "rentHistory.$.status": "paid" } }
    );

    res.json({
      success: true,
      message: "Payment recorded successfully",
      upserted: result.upsertedCount > 0,
    });
  } catch (err) {
    console.error("POST /rent-payments error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ GET: All rent payments for a user
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

// ✅ PATCH: Update a rent payment status
app.patch("/rent-payments/:id", verifyFireBaseToken, async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    const updateResult = await rentPaymentsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: status || "paid", paidAt: new Date() } }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ message: "Rent record not found" });
    }

    // Find updated rent payment to sync with user rentHistory
    const rentPayment = await rentPaymentsCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!rentPayment) {
      return res.status(404).json({ message: "Rent payment not found after update" });
    }

    await usersCollection.updateOne(
      { email: rentPayment.userEmail, "rentHistory.month": rentPayment.month },
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

    // GET all announcements
    app.get("/announcements", verifyFireBaseToken, async (req, res) => {
      const data = await announcementCollection
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
        const result = await announcementCollection.insertOne(body);
        res.send(result);
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

