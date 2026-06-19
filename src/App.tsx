import { useState, useEffect, useRef } from "react";
import { PCPart, PlayerBuild, Mod, MarketListing, AIContract, UserProfile, EvaluationResult, PCBrand } from "./types";
import { BASE_PARTS, getMockMarketListings } from "./partsData";
import { db, auth, handleFirestoreError, OperationType } from "./firebase";
import { 
  collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc, deleteDoc, onSnapshot, query, where, limit 
} from "firebase/firestore";
import { 
  signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, signInAnonymously 
} from "firebase/auth";
import BuildWorkshop from "./components/BuildWorkshop";
import MarketTrading from "./components/MarketTrading";
import ModdingStudio from "./components/ModdingStudio";
import ContractsHub from "./components/ContractsHub";
import ProfileConfig from "./components/ProfileConfig";
import LocalAuthModal from "./components/LocalAuthModal";
import { 
  Wrench, Users, TrendingUp, Sparkles, LogIn, LogOut, ShieldAlert, Award, Wallet, CircleUser, Laptop, RefreshCw, Key, UserPlus, ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [activeTab, setActiveTab] = useState<"workshop" | "contracts" | "trading" | "mods" | "profile">("workshop");
  
  // Player state
  const [userProfile, setUserProfile] = useState<UserProfile>({
    uid: "offline_user",
    displayName: "Guest Designer",
    budget: 4500, // starting funds to buy awesome pieces
    level: 1,
    xp: 0,
    subscribedMods: []
  });
  const [isSignedInState, setIsSignedInState] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // Local simulated accounts
  const [showLocalAuthModal, setShowLocalAuthModal] = useState(false);
  const [activeLocalUser, setActiveLocalUser] = useState<string | null>(() => {
    return localStorage.getItem("pc_sim_active_local_user");
  });
  const [localAccounts, setLocalAccounts] = useState<any[]>(() => {
    try {
      const stored = localStorage.getItem("pc_sim_local_accounts");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Inventories (Default has a subset of starter pieces so they can build right away)
  const [playerInventory, setPlayerInventory] = useState<PCPart[]>(BASE_PARTS.slice(0, 10));

  // Shared multiplayer-like lists
  const [firestoreMods, setFirestoreMods] = useState<Mod[]>([]);
  const [localPublishedMods, setLocalPublishedMods] = useState<Mod[]>([]);
  const [workshopMods, setWorkshopMods] = useState<Mod[]>([]);

  // Combine custom local mods with standard community mods reactive engine
  useEffect(() => {
    const filteredLocal = localPublishedMods.filter(lm => !firestoreMods.some(fm => fm.id === lm.id));
    const combined = [...filteredLocal, ...firestoreMods];
    if (combined.length > 0) {
      setWorkshopMods(combined);
    } else {
      setWorkshopMods(getStarterPreseededMods());
    }
  }, [firestoreMods, localPublishedMods]);
  const [marketListings, setMarketListings] = useState<MarketListing[]>([]);
  const [contracts, setContracts] = useState<AIContract[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);

  // Active builder PC
  const [currentBuild, setCurrentBuild] = useState<PlayerBuild>({
    id: "build_active_01",
    name: "Cyber Rig X",
    cpu: BASE_PARTS[1], // i5 starter
    gpu: BASE_PARTS[6], // 4060 starter
    motherboard: BASE_PARTS[11], // motherboard starter
    ram: BASE_PARTS[13], // Corsair starter
    storage: BASE_PARTS[16], // M.2 starter
    cooler: BASE_PARTS[19], // Air starter
    psu: BASE_PARTS[23], // PSU starter
    case: BASE_PARTS[25], // NZXT starter
    totalCost: 1500
  });

  const [firebaseStatus, setFirebaseStatus] = useState<"connected" | "offline">("connected");

  // PC Factory Brands & continuous sales logs
  const [pcBrands, setPcBrands] = useState<PCBrand[]>([]);
  const [salesLogs, setSalesLogs] = useState<{ id: string; text: string; timestamp: string; type: "success" | "warning" | "royalty" }[]>([]);

  const userProfileRef = useRef(userProfile);
  const pcBrandsRef = useRef(pcBrands);

  useEffect(() => {
    userProfileRef.current = userProfile;
  }, [userProfile]);

  useEffect(() => {
    pcBrandsRef.current = pcBrands;
  }, [pcBrands]);


  // On mount: listen for Auth & initialize databases arrays
  useEffect(() => {
    let unsubs: (() => void)[] = [];

    const activeUser = localStorage.getItem("pc_sim_active_local_user");
    if (activeUser) {
      setAuthLoading(true);
      const storedAccs = localStorage.getItem("pc_sim_local_accounts");
      const accList = storedAccs ? JSON.parse(storedAccs) : [];
      const match = accList.find((a: any) => a.username === activeUser);
      if (match) {
        setIsSignedInState(true);
        setUserProfile(match.userProfile);
        if (match.inventory) {
          setPlayerInventory(match.inventory);
        }
        if (match.pcBrands) {
          setPcBrands(match.pcBrands);
        }
        if (match.publishedMods) {
          setLocalPublishedMods(match.publishedMods);
        }
      } else {
        localStorage.removeItem("pc_sim_active_local_user");
      }
      setAuthLoading(false);
    } else {
      const authUnsub = onAuthStateChanged(auth, async (usr) => {
        setAuthLoading(true);
        if (usr) {
          setIsSignedInState(true);
          // Load or create player profile in Firestore
          const userDocRef = doc(db, "users", usr.uid);
          try {
            const snap = await getDoc(userDocRef);
            if (snap.exists()) {
              setUserProfile(snap.data() as UserProfile);
            } else {
              const initialProfile: UserProfile = {
                uid: usr.uid,
                displayName: usr.displayName || "Studio Builder",
                budget: 4000,
                level: 1,
                xp: 0,
                subscribedMods: []
              };
              await setDoc(userDocRef, initialProfile);
              setUserProfile(initialProfile);
            }
          } catch (err) {
            console.warn("Firestore user read write blocked, falling back to local simulation:", err);
            setFirebaseStatus("offline");
          }
        } else {
          setIsSignedInState(false);
          // Load offline profile from local storage if existing
          const cached = localStorage.getItem("pc_sim_offline_profile_v2");
          if (cached) {
            setUserProfile(JSON.parse(cached));
          }
        }
        setAuthLoading(false);
      });
      unsubs.push(authUnsub);
    }

    // Dynamic stream listen from Firestore: MODS (Workshop)
    const modsUnsub = onSnapshot(collection(db, "mods"), (snapshot) => {
      const list: Mod[] = [];
      snapshot.forEach(doc => {
        list.push({ ...doc.data() as Mod, id: doc.id });
      });
      setFirestoreMods(list);
    }, (error) => {
      console.warn("Shared Mod stream blocked, utilizing offline workshop catalog.", error);
      setFirestoreMods([]);
    });
    unsubs.push(modsUnsub);

    // Dynamic stream listen from Firestore: MARKET LISTINGS
    const marketUnsub = onSnapshot(collection(db, "market_listings"), (snapshot) => {
      const list: MarketListing[] = [];
      snapshot.forEach(doc => {
        list.push({ ...doc.data() as MarketListing, id: doc.id });
      });
      if (list.length > 0) {
        setMarketListings(list);
      } else {
        setMarketListings(getMockMarketListings(userProfile.level));
      }
    }, (error) => {
      console.warn("Market listing stream blocked, utilizing standard Tokyo Exchange simulation.", error);
      setMarketListings(getMockMarketListings(userProfile.level));
    });
    unsubs.push(marketUnsub);

    // Generate initial AI contracts on startup
    const cachedBrands = localStorage.getItem("pc_sim_offline_brands");
    if (cachedBrands) {
      try {
        setPcBrands(JSON.parse(cachedBrands));
      } catch (e) {
        console.error("Failed to parse cached brands:", e);
      }
    }

    fetchAIContracts();

    return () => {
      unsubs.forEach(un => un());
    };
  }, []);

  // Save profile state changes inside local storage as fallback
  useEffect(() => {
    localStorage.setItem("pc_sim_offline_profile_v2", JSON.stringify(userProfile));
    if (isSignedInState && auth.currentUser) {
      // Sync to cloud Firestore safely
      const userDocRef = doc(db, "users", auth.currentUser.uid);
      updateDoc(userDocRef, { ...userProfile }).catch(err => {
        console.warn("Failed to sync player profile to Firestore:", err);
      });
    }
  }, [userProfile]);

  // Sync to local account schema on any progress modification
  useEffect(() => {
    if (activeLocalUser) {
      setLocalAccounts(prev => {
        const next = prev.map(acc => {
          if (acc.username === activeLocalUser) {
            return {
              ...acc,
              userProfile,
              inventory: playerInventory,
              pcBrands,
              publishedMods: localPublishedMods
            };
          }
          return acc;
        });
        localStorage.setItem("pc_sim_local_accounts", JSON.stringify(next));
        return next;
      });
    }
  }, [userProfile, playerInventory, pcBrands, localPublishedMods, activeLocalUser]);

  // Stream pc_brands from Firestore when user is signed in
  useEffect(() => {
    if (isSignedInState && userProfile.uid !== "offline_user") {
      const q = query(collection(db, "pc_brands"), where("ownerId", "==", userProfile.uid));
      const unsub = onSnapshot(q, (snapshot) => {
        const list: PCBrand[] = [];
        snapshot.forEach(doc => {
          list.push({ ...doc.data() as PCBrand, id: doc.id });
        });
        if (list.length > 0) {
          setPcBrands(list);
        }
      }, (error) => {
        console.warn("Error streaming brands:", error);
      });
      return () => unsub();
    }
  }, [isSignedInState, userProfile.uid]);

  const handleRegisterBrand = async (brandData: PCBrand) => {
    setPcBrands(prev => {
      const updated = [brandData, ...prev];
      localStorage.setItem("pc_sim_offline_brands", JSON.stringify(updated));
      return updated;
    });

    if (isSignedInState && auth.currentUser) {
      try {
        await setDoc(doc(db, "pc_brands", brandData.id), brandData);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `pc_brands/${brandData.id}`);
      }
    }
  };

  const handleUpdateBrand = async (updatedBrand: PCBrand) => {
    setPcBrands(prev => {
      const updated = prev.map(b => b.id === updatedBrand.id ? updatedBrand : b);
      localStorage.setItem("pc_sim_offline_brands", JSON.stringify(updated));
      return updated;
    });

    if (isSignedInState && auth.currentUser) {
      try {
        await setDoc(doc(db, "pc_brands", updatedBrand.id), updatedBrand);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `pc_brands/${updatedBrand.id}`);
      }
    }
  };

  const handleDeleteBrand = async (brandId: string) => {
    setPcBrands(prev => {
      const updated = prev.filter(b => b.id !== brandId);
      localStorage.setItem("pc_sim_offline_brands", JSON.stringify(updated));
      return updated;
    });

    if (isSignedInState && auth.currentUser) {
      try {
        await deleteDoc(doc(db, "pc_brands", brandId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `pc_brands/${brandId}`);
      }
    }
  };

  // Continuous automated brand selling engine
  useEffect(() => {
    const interval = setInterval(() => {
      const currentBrands = pcBrandsRef.current;
      const currentUser = userProfileRef.current;
      
      const activeBrands = currentBrands.filter(b => b.isAutoEnabled || b.isLicensingEnabled);
      if (activeBrands.length === 0) return;

      const brand = activeBrands[Math.floor(Math.random() * activeBrands.length)];
      const markupRatio = brand.salePrice / brand.productionCost;
      let chance = 40; // baseline 40%
      
      if (markupRatio > 1.5) {
        chance -= 25; // price is too high
      } else if (markupRatio < 1.1) {
        chance += 20; // competitive pricing!
      }
      
      chance += Math.min(25, brand.performanceScore / 35);

      if (Math.random() * 100 <= chance) {
        const timestamp = new Date().toLocaleTimeString();
        if (brand.isAutoEnabled) {
          if (currentUser.budget >= brand.productionCost) {
            const netProfit = brand.salePrice - brand.productionCost;
            const xpAwarded = Math.round(100 + (brand.performanceScore * 0.15));
            
            setUserProfile(prev => {
              const nextXp = prev.xp + xpAwarded;
              const requiredXp = prev.level * 350;
              let nextLevel = prev.level;
              let finalXp = nextXp;

              if (finalXp >= requiredXp) {
                finalXp -= requiredXp;
                nextLevel += 1;
              }

              return {
                ...prev,
                budget: prev.budget + netProfit,
                xp: finalXp,
                level: nextLevel
              };
            });

            // Update brand stats
            const updatedBrand = {
              ...brand,
              totalSold: brand.totalSold + 1,
              totalProfit: brand.totalProfit + netProfit
            };
            handleUpdateBrand(updatedBrand);

            setSalesLogs(prev => [
              {
                id: "log_" + Math.random().toString(36).substring(2, 7),
                text: `✨ [自社ブランド売却] 『${brand.name}』が1台出荷されました！ 価格: $${brand.salePrice} (製造原価: $${brand.productionCost}) 利益 +$${netProfit}`,
                timestamp,
                type: "success"
              },
              ...prev.slice(0, 15)
            ]);
          } else {
            setSalesLogs(prev => [
              {
                id: "log_" + Math.random().toString(36).substring(2, 7),
                text: `⚠️ [生産一時停止] 資金不足のため『${brand.name}』のシリアル組み立てを保留しました。（必要額: $${brand.productionCost}）`,
                timestamp,
                type: "warning"
              },
              ...prev.slice(0, 15)
            ]);
          }
        } else if (brand.isLicensingEnabled) {
          const royaltyFee = Math.round(brand.productionCost * 0.12);
          const xpAwarded = 35;

          setUserProfile(prev => {
            const nextXp = prev.xp + xpAwarded;
            const requiredXp = prev.level * 350;
            let nextLevel = prev.level;
            let finalXp = nextXp;

            if (finalXp >= requiredXp) {
              finalXp -= requiredXp;
              nextLevel += 1;
            }

            return {
              ...prev,
              budget: prev.budget + royaltyFee,
              xp: finalXp,
              level: nextLevel
            };
          });

          const updatedBrand = {
            ...brand,
            totalSold: brand.totalSold + 1,
            totalProfit: brand.totalProfit + royaltyFee
          };
          handleUpdateBrand(updatedBrand);

          setSalesLogs(prev => [
            {
              id: "log_" + Math.random().toString(36).substring(2, 7),
              text: `📜 [ライセンス技術料] ロイヤリティ契約に基づき『${brand.name}』特許使用料 +$${royaltyFee} を受領しました！`,
              timestamp,
              type: "royalty"
            },
            ...prev.slice(0, 15)
          ]);
        }
      }
    }, 16000);

    return () => clearInterval(interval);
  }, []);

  // Support functions
  const handleAuthLoginGoogle = async () => {
    setShowLocalAuthModal(true);
  };

  const handleLocalLoginSuccess = (
    username: string, 
    profile: any, 
    inventory: PCPart[], 
    brands: any[],
    publishedMods?: any[]
  ) => {
    setActiveLocalUser(username);
    localStorage.setItem("pc_sim_active_local_user", username);
    setIsSignedInState(true);
    setUserProfile(profile);
    setPlayerInventory(inventory);
    setPcBrands(brands);
    setLocalPublishedMods(publishedMods || []);
  };

  const handleLocalRegisterSuccess = (
    username: string, 
    password: string, 
    profile: any, 
    inventory: PCPart[]
  ) => {
    const newAccount = {
      username,
      password,
      userProfile: profile,
      inventory,
      pcBrands: [],
      publishedMods: []
    };

    setLocalAccounts(prev => {
      const updated = [...prev, newAccount];
      localStorage.setItem("pc_sim_local_accounts", JSON.stringify(updated));
      return updated;
    });

    setActiveLocalUser(username);
    localStorage.setItem("pc_sim_active_local_user", username);
    setIsSignedInState(true);
    setUserProfile(profile);
    setPlayerInventory(inventory);
    setPcBrands([]);
    setLocalPublishedMods([]);
  };

  const handleAuthLogout = async () => {
    try {
      if (activeLocalUser) {
        localStorage.removeItem("pc_sim_active_local_user");
        setActiveLocalUser(null);
      } else {
        await signOut(auth);
      }
      setIsSignedInState(false);
      // Reset offline guest
      setUserProfile({
        uid: "offline_user",
        displayName: "Guest Designer",
        budget: 4500,
        level: 1,
        xp: 0,
        subscribedMods: []
      });
      setPlayerInventory(BASE_PARTS.slice(0, 10));
      setPcBrands([]);
      setLocalPublishedMods([]);
      setFirestoreMods([]);
    } catch (err) {
      console.error(err);
    }
  };

  // Generate dynamic AI customer contracts calling backend node
  const fetchAIContracts = async () => {
    setContractsLoading(true);
    try {
      const promises = Array.from({ length: 3 }).map(async () => {
        const response = await fetch("/api/contracts/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerLevel: userProfile.level })
        });
        return await response.json();
      });
      const results = await Promise.all(promises);
      setContracts(results);
    } catch (err) {
      console.error("Failed to generate AI contracts, calling offline mock contracts instead.", err);
    } finally {
      setContractsLoading(false);
    }
  };

  // Evaluate submitted player build on server endpoint
  const handleSubmitBuildContract = async (contract: AIContract, build: PlayerBuild): Promise<EvaluationResult> => {
    // Calling our server API route which wraps `@google/genai` securely
    const response = await fetch("/api/contracts/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract, build })
    });
    const result: EvaluationResult = await response.json();
    return result;
  };

  // Complete contract transaction: payout money and leveling XP
  const handleAcceptContractReward = (payout: number, bonus: number, xpAwarded: number) => {
    const nextXp = userProfile.xp + xpAwarded;
    const requiredXp = userProfile.level * 350;
    let nextLevel = userProfile.level;

    if (nextXp >= requiredXp) {
      nextLevel += 1;
    }

    setUserProfile(prev => ({
      ...prev,
      budget: prev.budget + payout + bonus,
      xp: nextXp >= requiredXp ? nextXp - requiredXp : nextXp,
      level: nextLevel
    }));

    // Reset building workshop so they can start fresh
    setCurrentBuild({
      id: "build_active_01",
      name: "Cyber Rig X",
      cpu: null,
      gpu: null,
      motherboard: null,
      ram: null,
      storage: null,
      cooler: null,
      psu: null,
      case: null,
      totalCost: 0
    });

    // Refresh job board contracts
    fetchAIContracts();
  };

  // Shop / Trading mechanics
  const handleBuyPart = (part: PCPart) => {
    if (userProfile.budget < part.price) return;
    setUserProfile(prev => ({ ...prev, budget: prev.budget - part.price }));
    setPlayerInventory(prev => [...prev, part]);
    
    // Remove the card listing from Firestore database if it was a real user listing
    const matchedListing = marketListings.find(l => l.partData.id === part.id);
    if (matchedListing && isSignedInState) {
      deleteDoc(doc(db, "market_listings", matchedListing.id)).catch(err => {
        handleFirestoreError(err, OperationType.DELETE, `market_listings/${matchedListing.id}`);
      });
    }
  };

  const handleBuyPC = (pc: PlayerBuild, price: number) => {
    if (userProfile.budget < price) return;
    setUserProfile(prev => ({ ...prev, budget: prev.budget - price }));
    
    // Deconstruct and add all parts of the built PC to the inventory
    const partsArray = [pc.cpu, pc.gpu, pc.motherboard, pc.ram, pc.storage, pc.cooler, pc.psu, pc.case].filter(Boolean) as PCPart[];
    setPlayerInventory(prev => [...prev, ...partsArray]);

    // Delete listing if multi-user
    const matchedListing = marketListings.find(l => l.partData.id === pc.id);
    if (matchedListing && isSignedInState) {
      deleteDoc(doc(db, "market_listings", matchedListing.id)).catch(err => {
        handleFirestoreError(err, OperationType.DELETE, `market_listings/${matchedListing.id}`);
      });
    }
  };

  const handleSellPart = (partId: string, sellPrice: number) => {
    setPlayerInventory(prev => prev.filter(p => p.id !== partId));
    // If offline user or fallback
    if (!isSignedInState) {
      setUserProfile(prev => ({ ...prev, budget: prev.budget + sellPrice }));
    }
  };

  const handleCreateListing = async (part: PCPart, price: number) => {
    const listingId = "listing_" + Math.random().toString(36).substring(2, 7);
    const newListing: MarketListing = {
      id: listingId,
      sellerId: userProfile.uid,
      sellerName: userProfile.displayName,
      itemType: "part",
      price,
      partData: part,
      createdAt: new Date().toISOString()
    };

    if (isSignedInState) {
      try {
        await setDoc(doc(db, "market_listings", listingId), newListing);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `market_listings/${listingId}`);
      }
    } else {
      // Local fallback listing simulation adding
      setMarketListings(prev => [newListing, ...prev]);
      setUserProfile(prev => ({ ...prev, budget: prev.budget + price }));
    }
  };

  const handleReleasePC = async (pcName: string, saleType: "market" | "instant", price: number) => {
    // 1. Gather all active parts
    const partsArray = [
      currentBuild.cpu,
      currentBuild.gpu,
      currentBuild.motherboard,
      currentBuild.ram,
      currentBuild.storage,
      currentBuild.cooler,
      currentBuild.psu,
      currentBuild.case
    ].filter(Boolean) as PCPart[];

    // 2. Consume from player inventory
    setPlayerInventory(prev => {
      const updated = [...prev];
      for (const part of partsArray) {
        const foundIdx = updated.findIndex(p => p.id === part.id);
        if (foundIdx !== -1) {
          updated.splice(foundIdx, 1);
        }
      }
      return updated;
    });

    if (saleType === "instant") {
      // Instant cash payout + XP boost
      const xpAwarded = 200 + userProfile.level * 40;
      const nextXp = userProfile.xp + xpAwarded;
      const requiredXp = userProfile.level * 350;
      let nextLevel = userProfile.level;
      let finalXp = nextXp;

      if (finalXp >= requiredXp) {
        finalXp -= requiredXp;
        nextLevel += 1;
      }

      setUserProfile(prev => ({
        ...prev,
        budget: prev.budget + price,
        xp: finalXp,
        level: nextLevel
      }));
    } else {
      // Add custom build to trade board
      const listingId = "listing_pc_" + Math.random().toString(36).substring(2, 7);
      const customPCBuild: PlayerBuild = {
        ...currentBuild,
        name: pcName,
      };
      
      const newListing: MarketListing = {
        id: listingId,
        sellerId: userProfile.uid,
        sellerName: userProfile.displayName,
        itemType: "pc",
        price,
        partData: customPCBuild,
        createdAt: new Date().toISOString()
      };

      if (isSignedInState) {
        try {
          await setDoc(doc(db, "market_listings", listingId), newListing);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `market_listings/${listingId}`);
        }
      } else {
        setMarketListings(prev => [newListing, ...prev]);
      }
    }

    // Reset workshop rig to empty so player can build a new one
    setCurrentBuild({
      id: "build_active_" + Math.random().toString(36).substring(2, 7),
      name: "Cyber Rig X",
      cpu: null,
      gpu: null,
      motherboard: null,
      ram: null,
      storage: null,
      cooler: null,
      psu: null,
      case: null,
      totalCost: 0
    });
  };

  // Workshop Mods engine
  const handlePublishMod = async (modData: Partial<Mod>) => {
    const modId = "mod_" + Math.random().toString(36).substring(2, 7);
    const completeMod: Mod = {
      id: modId,
      authorId: userProfile.uid,
      authorName: userProfile.displayName,
      name: modData.name || "Default Part Mod",
      partType: modData.partType || "cpu",
      description: modData.description || "Community Custom Skin",
      skinColor: modData.skinColor || "#06b6d4",
      stats: modData.stats || {},
      subscriptions: 0,
      rating: 5,
      createdAt: new Date().toISOString()
    };

    // Auto-subscribe the newly self-published mod so the player can immediately use it in the assembly rig
    const customModAsPart: PCPart = {
      id: completeMod.id,
      name: `${completeMod.name} (Mod製品)`,
      category: completeMod.partType,
      brand: completeMod.stats.brand || "WorkshopMod",
      price: completeMod.stats.price || 250,
      socket: completeMod.partType === "cpu" || completeMod.partType === "motherboard" ? "AM5" : undefined,
      cores: completeMod.partType === "cpu" ? completeMod.stats.primaryVal : undefined,
      vram: completeMod.partType === "gpu" ? completeMod.stats.primaryVal : undefined,
      size: completeMod.partType === "ram" || completeMod.partType === "storage" ? completeMod.stats.primaryVal : undefined,
      power: 100,
      isMod: true,
      authorName: completeMod.authorName,
      imageColor: completeMod.skinColor
    };

    setPlayerInventory(prev => [...prev, customModAsPart]);
    setUserProfile(prev => ({
      ...prev,
      subscribedMods: [...prev.subscribedMods, completeMod.id]
    }));

    const isCloudUser = isSignedInState && auth.currentUser && !activeLocalUser;
    if (isCloudUser) {
      try {
        await setDoc(doc(db, "mods", modId), completeMod);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `mods/${modId}`);
      }
    } else {
      setLocalPublishedMods(prev => [completeMod, ...prev]);
    }
  };

  // AI Mod Evaluation logic (based on Cospa and Simplicity)
  const handleEvaluateModWithAI = async (modId: string) => {
    const targetMod = workshopMods.find(m => m.id === modId);
    if (!targetMod) return;

    try {
      const res = await fetch("/api/mods/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mod: targetMod })
      });
      const data = await res.json();

      const evaluationData = {
        cospaRating: data.cospaRating || 50,
        simplicityRating: data.simplicityRating || 50,
        feedback: data.feedback || "AIによる査定が完了しました。",
        evaluatedAt: new Date().toISOString()
      };

      const subsValue = data.recommendedSubscriptions || 150;

      const isCloudUser = isSignedInState && auth.currentUser && !activeLocalUser;
      if (isCloudUser) {
        await updateDoc(doc(db, "mods", modId), {
          subscriptions: subsValue,
          aiEvaluation: evaluationData
        });
      } else {
        setLocalPublishedMods(prev => prev.map(m => m.id === modId ? {
          ...m,
          subscriptions: subsValue,
          aiEvaluation: evaluationData
        } : m));
      }

      // Add to sales logs for visual user feedback
      const logMsg = `💡 [AI MOD査定] 自作パーツ『${targetMod.name}』をコスパ、説明の簡単さの2軸でAI審査！サブスク数: ${subsValue}を獲得しました！`;
      setSalesLogs(prev => [
        {
          id: "mod_log_" + Math.random().toString(36).substring(2, 7),
          text: logMsg,
          timestamp: new Date().toLocaleTimeString(),
          type: "success"
        },
        ...prev
      ]);
    } catch (err) {
      console.error("AI MOD Evaluation triggered error:", err);
    }
  };

  // Fast forward mod created time by 5 minutes for developer & player quick testing
  const handleFastForwardModTime = async (modId: string) => {
    const targetMod = workshopMods.find(m => m.id === modId);
    if (!targetMod) return;

    // Shift createdAt time back by 305 seconds (slightly over 5 minutes)
    const fiveMinsAgo = new Date(Date.now() - 305 * 1000).toISOString();

    const isCloudUser = isSignedInState && auth.currentUser && !activeLocalUser;
    if (isCloudUser) {
      await updateDoc(doc(db, "mods", modId), {
        createdAt: fiveMinsAgo
      });
    } else {
      setLocalPublishedMods(prev => prev.map(m => m.id === modId ? {
        ...m,
        createdAt: fiveMinsAgo
      } : m));
    }

    const logMsg = `⏰ MOD『${targetMod.name}』の時間を+5分早送りしました。これにより5分経過したと判定されます。`;
    setSalesLogs(prev => [
      {
        id: "mod_log_" + Math.random().toString(36).substring(2, 7),
        text: logMsg,
        timestamp: new Date().toLocaleTimeString(),
        type: "royalty"
      },
      ...prev
    ]);
  };

  // Automated background AI evaluator for owner's mods after 5 minutes with 0 subscriptions.
  useEffect(() => {
    const interval = setInterval(() => {
      const myUid = userProfile.uid;
      const now = Date.now();
      
      const unEvaluatedAndMatured = workshopMods.find(m => {
        const isMine = m.authorId === myUid;
        const hasNoSubs = m.subscriptions === 0;
        const notEvaluated = !m.aiEvaluation;
        
        if (isMine && hasNoSubs && notEvaluated) {
          const createdTime = new Date(m.createdAt).getTime();
          const elapsedSecs = (now - createdTime) / 1000;
          return elapsedSecs >= 300; // 5 minutes threshold (300 seconds)
        }
        return false;
      });

      if (unEvaluatedAndMatured) {
        console.log(`Auto trigger AI evaluation for mod: ${unEvaluatedAndMatured.name}`);
        handleEvaluateModWithAI(unEvaluatedAndMatured.id);
      }
    }, 8000); // Check every 8 seconds

    return () => clearInterval(interval);
  }, [workshopMods, userProfile.uid, isSignedInState]);

  // Mod Workshop subscription toggle
  const handleSubscribeMod = async (modId: string) => {
    const isAlreadySubbed = userProfile.subscribedMods.includes(modId);
    let nextSubMods = [...userProfile.subscribedMods];

    if (isAlreadySubbed) {
      nextSubMods = nextSubMods.filter(id => id !== modId);
    } else {
      nextSubMods.push(modId);
      // Construct parts copy and inject directly into the inventory assembler catalog!
      const matchedMod = workshopMods.find(m => m.id === modId);
      if (matchedMod) {
        const customModAsPart: PCPart = {
          id: matchedMod.id,
          name: `${matchedMod.name} (Mod製品)`,
          category: matchedMod.partType,
          brand: matchedMod.stats.brand || "WorkshopMod",
          price: matchedMod.stats.price || 250,
          socket: matchedMod.partType === "cpu" || matchedMod.partType === "motherboard" ? "AM5" : undefined,
          cores: matchedMod.partType === "cpu" ? matchedMod.stats.primaryVal : undefined,
          vram: matchedMod.partType === "gpu" ? matchedMod.stats.primaryVal : undefined,
          size: matchedMod.partType === "ram" || matchedMod.partType === "storage" ? matchedMod.stats.primaryVal : undefined,
          power: 100,
          isMod: true,
          authorName: matchedMod.authorName,
          imageColor: matchedMod.skinColor
        };
        setPlayerInventory(prev => [...prev, customModAsPart]);
      }
    }

    setUserProfile(prev => ({ ...prev, subscribedMods: nextSubMods }));

    // Increment subscribe counter on Firestore Mod document
    const isCloudUser = isSignedInState && auth.currentUser && !activeLocalUser;
    if (isCloudUser) {
      const modDocRef = doc(db, "mods", modId);
      const matchedMod = workshopMods.find(m => m.id === modId);
      if (matchedMod) {
        updateDoc(modDocRef, {
          subscriptions: matchedMod.subscriptions + (isAlreadySubbed ? -1 : 1)
        }).catch(err => console.warn(err));
      }
    } else {
      setLocalPublishedMods(prev => prev.map(m => m.id === modId ? { ...m, subscriptions: m.subscriptions + (isAlreadySubbed ? -1 : 1) } : m));
    }
  };

  // Toggle assembly availability of a custom Mod
  const handleToggleModAssembly = (modId: string, activate: boolean) => {
    if (activate) {
      const exists = playerInventory.some(p => p.id === modId);
      if (!exists) {
        const matchedMod = workshopMods.find(m => m.id === modId);
        if (matchedMod) {
          const customModAsPart: PCPart = {
            id: matchedMod.id,
            name: `${matchedMod.name} (Mod製品)`,
            category: matchedMod.partType,
            brand: matchedMod.stats.brand || "WorkshopMod",
            price: matchedMod.stats.price || 250,
            socket: matchedMod.partType === "cpu" || matchedMod.partType === "motherboard" ? "AM5" : undefined,
            cores: matchedMod.partType === "cpu" ? matchedMod.stats.primaryVal : undefined,
            vram: matchedMod.partType === "gpu" ? matchedMod.stats.primaryVal : undefined,
            size: matchedMod.partType === "ram" || matchedMod.partType === "storage" ? matchedMod.stats.primaryVal : undefined,
            power: 100,
            isMod: true,
            authorName: matchedMod.authorName,
            imageColor: matchedMod.skinColor
          };
          setPlayerInventory(prev => [...prev, customModAsPart]);

          // Auto subscribe as well on Steam-style workshop for compatibility and statistics
          const isAlreadySubbed = userProfile.subscribedMods.includes(modId);
          if (!isAlreadySubbed) {
            handleSubscribeMod(modId);
          }
        }
      }
    } else {
      // Remove from inventory
      setPlayerInventory(prev => prev.filter(p => p.id !== modId));
    }
  };

  // Local boot simulation diagnostics
  const handleRunBootDiagnostic = async (build: PlayerBuild) => {
    const fpsScore = Math.floor(
      ((build.cpu?.cores || 0) * 800) + 
      ((build.gpu?.vram || 0) * 450) + 
      ((build.ram?.size || 0) * 30) - 
      ((build.cooler?.type === "Air" ? 150 : 0))
    );
    const wattsUsed = (build.cpu?.power || 0) + (build.gpu?.power || 0) + 140;
    const thermalC = build.cooler?.name?.includes("Kraken") ? 38 : (build.cooler?.name?.includes("iCUE") ? 42 : 58);

    return {
      isSuccess: true,
      diagnostics: ["BIOS initialization: Complete", "DDR5 Sub-TIMINGS: Loaded", "PCI-Express Bandwidth check: PASS"],
      fpsScore,
      wattsUsed,
      thermalC
    };
  };

  return (
    <div className="min-h-screen bg-[#090a0f] text-slate-100 flex flex-col font-sans selection:bg-teal-500/30 selection:text-teal-200">
      
      {/* Visual cyber-indicator bar */}
      <div className="h-1 bg-gradient-to-r from-teal-500 via-purple-500 to-amber-500 w-full" />

      {/* Cyber-industrial page Header bar */}
      <header className="bg-slate-950/80 backdrop-blur-md border-b border-slate-900 sticky top-0 z-40 px-4 md:px-8 py-3.5 flex flex-col sm:flex-row justify-between items-center gap-4">
        
        {/* Left branding */}
        <div className="flex items-center space-x-3 text-left">
          <div className="bg-gradient-to-br from-teal-500 to-indigo-600 p-2 rounded-xl border border-teal-400/20 shadow-lg shadow-teal-500/10">
            <Laptop className="w-6 h-6 text-slate-950 stroke-[2] text-slate-100" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-extrabold font-sans tracking-tight text-white uppercase">
                PC Builder Simulator
              </h1>
              <span className="text-[9px] bg-teal-950 text-teal-400 border border-teal-900 px-1.5 py-0.5 rounded font-mono uppercase tracking-widest font-bold">
                PRO-DESKTOP
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">
              High-Res Visual Assemblies & Steam Workshop Modding
            </p>
          </div>
        </div>

        {/* Center player indicators */}
        <div className="flex items-center space-x-4">
          {/* Cash balance widget */}
          <div className="flex items-center space-x-2 bg-slate-900/80 px-3.5 py-2 rounded-lg border border-slate-800">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <div className="text-left font-mono">
              <span className="text-[9px] text-slate-500 block uppercase leading-tight font-sans">Cash Assets</span>
              <span className="text-xs font-bold text-emerald-300">${userProfile.budget.toLocaleString()}</span>
            </div>
          </div>

          {/* Level / XP widget */}
          <div className="flex items-center space-x-2 bg-slate-900/80 px-3.5 py-2 rounded-lg border border-slate-800">
            <Award className="w-4 h-4 text-teal-400" />
            <div className="text-left">
              <span className="text-[9px] text-slate-500 block uppercase leading-tight font-sans">Player Level</span>
              <div className="flex items-center space-x-1.5 font-mono">
                <span className="text-xs font-bold text-white">LV.{userProfile.level}</span>
                <span className="text-[10px] text-teal-400 bg-teal-950/40 px-1 rounded">
                  XP: {userProfile.xp}/{userProfile.level * 350}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Auth controllers */}
        <div className="flex items-center space-x-3">
          {authLoading ? (
            <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />
          ) : isSignedInState ? (
            <div className="flex items-center space-x-2.5">
              <div className="text-right">
                <p className="text-xs font-bold text-slate-100">{userProfile.displayName}</p>
                <span className="text-[9px] font-mono text-emerald-400">
                  {activeLocalUser ? "● Local Account Active" : "● Steam Cloud Synced"}
                </span>
              </div>
              <button
                onClick={handleAuthLogout}
                title="ログアウト"
                className="p-1.5 bg-slate-900 border border-slate-800 hover:bg-red-950/20 hover:border-red-900 rounded-lg text-slate-400 hover:text-red-400 transition-all font-sans cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleAuthLoginGoogle}
              className="px-3.5 py-2 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-teal-500/15 flex items-center space-x-1.5 cursor-pointer font-sans"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>アカウント作成・ログイン</span>
            </button>
          )}
        </div>
      </header>

      {/* Primary Navigation tab controllers */}
      <div className="bg-slate-950/40 border-b border-slate-900 py-3 px-4 md:px-8 flex justify-center">
        <nav className="flex space-x-1 bg-slate-950 p-1.5 rounded-xl border border-slate-900 max-w-3xl w-full">
          {[
            { id: "workshop", label: "PC Assembly (組立工房)", icon: Wrench },
            { id: "contracts", label: "Client Jobs (AI案件)", icon: Users },
            { id: "trading", label: "Parts Trade (取引市場)", icon: TrendingUp },
            { id: "mods", label: "Workshop Mod (MODスタジオ)", icon: Sparkles },
            { id: "profile", label: "Profile (ユーザー情報)", icon: CircleUser }
          ].map((tab) => {
            const IconComponent = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 flex flex-col md:flex-row items-center justify-center space-y-1 md:space-y-0 md:space-x-1.5 py-2 md:py-2.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
                  active
                    ? "bg-slate-905 bg-gradient-to-r from-teal-950/50 to-indigo-950/50 text-teal-400 shadow-sm border border-teal-500/35"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-900/40"
                }`}
              >
                <IconComponent className={`w-4 h-4 ${active ? 'text-teal-400' : 'text-slate-400'}`} />
                <span className="text-[11px] md:text-xs font-sans font-extrabold tracking-tight">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Content viewport */}
      <main className="flex-grow max-w-7xl w-full mx-auto p-4 md:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            {activeTab === "workshop" && (
              <BuildWorkshop 
                currentBuild={currentBuild}
                inventory={playerInventory}
                onUpdateBuild={setCurrentBuild}
                onRunBootDiagnostic={handleRunBootDiagnostic}
                playerBudget={userProfile.budget}
                onBuyPart={handleBuyPart}
                onReleasePC={handleReleasePC}
                brands={pcBrands}
                onRegisterBrand={handleRegisterBrand}
                onUpdateBrand={handleUpdateBrand}
                onDeleteBrand={handleDeleteBrand}
                salesLogs={salesLogs}
                userLevel={userProfile.level}
              />
            )}

            {activeTab === "contracts" && (
              <ContractsHub 
                contractsList={contracts}
                currentBuild={currentBuild}
                onRefreshContracts={fetchAIContracts}
                onSubmitBuild={handleSubmitBuildContract}
                onAcceptReward={handleAcceptContractReward}
                isLoading={contractsLoading}
              />
            )}

            {activeTab === "trading" && (
              <MarketTrading 
                playerBudget={userProfile.budget}
                inventory={playerInventory}
                marketListings={marketListings}
                onBuyPart={handleBuyPart}
                onBuyPC={handleBuyPC}
                onSellPart={handleSellPart}
                onCreateListing={handleCreateListing}
                onRefreshMarket={() => setMarketListings(getMockMarketListings(userProfile.level))}
              />
            )}

            {activeTab === "mods" && (
              <ModdingStudio 
                modsList={workshopMods}
                mySubscribedMods={userProfile.subscribedMods}
                userId={userProfile.uid}
                userName={userProfile.displayName}
                onPublishMod={handlePublishMod}
                onSubscribeMod={handleSubscribeMod}
                onEvaluateModWithAI={handleEvaluateModWithAI}
                onFastForwardModTime={handleFastForwardModTime}
                playerInventory={playerInventory}
                onToggleModAssembly={handleToggleModAssembly}
              />
            )}

            {activeTab === "profile" && (
              <ProfileConfig 
                userProfile={userProfile}
                onUpdateProfile={setUserProfile}
                isSignedIn={isSignedInState}
                onAddSpecialPart={(part) => setPlayerInventory(prev => [...prev, part])}
                ownedSpecialParts={playerInventory.map(p => p.id)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer credits and system indicators */}
      <footer className="bg-slate-950 border-t border-slate-900 py-6 px-4 text-center mt-12 bg-grid-pattern">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center text-slate-500 text-xs font-mono gap-4">
          <p className="text-left">
            © 2026 PC Building Simulator & Market. Developed on high-fidelity desktop specifications.
          </p>
          <div className="flex space-x-4 items-center">
            <span className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-teal-400" />
              <span>Multiplayer Server: Online</span>
            </span>
            <span className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              <span>Steam Workshop Service: Integrated</span>
            </span>
          </div>
        </div>
      </footer>

      <AnimatePresence>
        {showLocalAuthModal && (
          <LocalAuthModal
            isOpen={showLocalAuthModal}
            onClose={() => setShowLocalAuthModal(false)}
            accounts={localAccounts}
            onLoginSuccess={handleLocalLoginSuccess}
            onRegisterSuccess={handleLocalRegisterSuccess}
          />
        )}
      </AnimatePresence>

    </div>
  );
}

// Starter fallback mods definition
function getStarterPreseededMods(): Mod[] {
  return [
    {
      id: "mod_pre_1",
      authorId: "creator_mod_1",
      authorName: "QuantumBuilder",
      name: "100-Core Photon Processor",
      partType: "cpu",
      description: "光量子もつれ回路を利用して100コア同時並列演算を可能にしたモデラー設計プロセッサ。消費電力が非常に高いが圧倒的なFPS性能を誇る。",
      skinColor: "#ec4899",
      stats: {
        brand: "QuantumMod",
        price: 1800,
        primaryVal: 100,
        colorHex: "#ec4899"
      },
      subscriptions: 1450,
      rating: 4.9,
      createdAt: new Date().toISOString()
    },
    {
      id: "mod_pre_2",
      authorId: "creator_mod_2",
      authorName: "TokyoNeonGuy",
      name: "Aura LED liquid blocks",
      partType: "cooler",
      description: "無限鏡面反射効果(Infinity Mirror LED)を組み込んだ水冷ヘッドとARGBファン搭載の水冷システムモディファイ品。",
      skinColor: "#22c55e",
      stats: {
        brand: "NeonEngine",
        price: 320,
        primaryVal: 480,
        colorHex: "#22c55e"
      },
      subscriptions: 920,
      rating: 4.8,
      createdAt: new Date().toISOString()
    }
  ];
}
