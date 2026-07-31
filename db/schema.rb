# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_07_31_150100) do
  create_table "matches", force: :cascade do |t|
    t.string "character_one", null: false
    t.string "character_two", null: false
    t.datetime "created_at", null: false
    t.integer "duration_seconds", default: 0, null: false
    t.json "game_scores", default: [], null: false
    t.integer "games_one", default: 0, null: false
    t.integer "games_two", default: 0, null: false
    t.integer "longest_rally", default: 0, null: false
    t.string "player_one", null: false
    t.string "player_two", null: false
    t.integer "room_id"
    t.integer "total_rallies", default: 0, null: false
    t.datetime "updated_at", null: false
    t.integer "winner", null: false
    t.index ["character_one"], name: "index_matches_on_character_one"
    t.index ["character_two"], name: "index_matches_on_character_two"
    t.index ["created_at"], name: "index_matches_on_created_at"
    t.index ["room_id"], name: "index_matches_on_room_id"
  end

  create_table "rooms", force: :cascade do |t|
    t.string "code", null: false
    t.datetime "created_at", null: false
    t.string "guest_character"
    t.string "guest_name"
    t.string "host_character", null: false
    t.string "host_name", null: false
    t.datetime "last_seen_at"
    t.string "seed", null: false
    t.string "status", default: "waiting", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_rooms_on_code", unique: true
    t.index ["status", "created_at"], name: "index_rooms_on_status_and_created_at"
  end

  add_foreign_key "matches", "rooms"
end
